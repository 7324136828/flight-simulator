"""FastAPI application entry point for the productionized Flight Simulator web app."""

from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from .config import (
    BACKEND_HOST,
    BACKEND_PORT,
    get_cors_origins,
    get_database_path,
)
from .database import Database
from .schemas.flight import FlightCreate, FlightResponse, FlightSummary
from .schemas.job import JobDiscardResponse, JobResponse
from .schemas.scenery import ManifestResponse
from .services.flight_service import FlightService
from .services.pipeline import PipelineRunner
from .services.scenery_service import SceneryService
from .store import CounterState, CounterStore
from .utils.temp_manager import TempManager


class CounterResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    count: int
    updated_at: str


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_temp_manager(request: Request) -> TempManager:
    return request.app.state.temp_manager


def get_pipeline(request: Request) -> PipelineRunner:
    return request.app.state.pipeline


def get_flight_service(request: Request) -> FlightService:
    return request.app.state.flight_service


def get_scenery_service(request: Request) -> SceneryService:
    return request.app.state.scenery_service


def get_counter_store(request: Request) -> CounterStore:
    return request.app.state.counter_store


def create_app(database_path: Path | None = None, db_path: Path | None = None) -> FastAPI:
    db_file = database_path or db_path or get_database_path()
    database = Database(db_file)
    database.initialize()

    counter_store = CounterStore(db_file)
    try:
        counter_store.initialize()
    except Exception:
        pass

    temp_manager = TempManager()
    pipeline = PipelineRunner(database, temp_manager)
    flight_service = FlightService(database, temp_manager)
    scenery_service = SceneryService()

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        yield

    application = FastAPI(
        title="Flight Simulator Production API",
        description="Backend API supporting Three.js flight simulation, flight telemetry logbook, and isolated data conversion pipelines.",
        version="2.0.0",
        lifespan=lifespan,
    )

    # Attach services to state immediately
    application.state.db = database
    application.state.counter_store = counter_store
    application.state.temp_manager = temp_manager
    application.state.pipeline = pipeline
    application.state.flight_service = flight_service
    application.state.scenery_service = scenery_service

    application.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- Health Check ---
    @application.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "app": "Flight Simulator Production API"}

    # --- Scenery & Maps API ---
    @application.get("/api/maps", response_model=ManifestResponse)
    def list_maps(scenery: SceneryService = Depends(get_scenery_service)) -> dict[str, Any]:
        try:
            return scenery.get_manifest()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to load scenery manifest: {e}")

    @application.get("/api/maps/{map_id}")
    def get_map(map_id: str, scenery: SceneryService = Depends(get_scenery_service)) -> dict[str, Any]:
        try:
            return scenery.get_map(map_id)
        except (KeyError, FileNotFoundError) as e:
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @application.get("/api/runways")
    def list_runways(
        map_id: str | None = None,
        scenery: SceneryService = Depends(get_scenery_service),
    ) -> list[dict[str, Any]]:
        return scenery.list_runways(map_id)

    # --- Flight Telemetry & Logbook API ---
    @application.post("/api/flights", response_model=FlightResponse, status_code=status.HTTP_201_CREATED)
    def save_flight(
        payload: FlightCreate,
        flights: FlightService = Depends(get_flight_service),
    ) -> dict[str, Any]:
        return flights.record_flight(payload.model_dump())

    @application.get("/api/flights", response_model=list[FlightSummary])
    def list_flights(flights: FlightService = Depends(get_flight_service)) -> list[dict[str, Any]]:
        return flights.list_flights()

    @application.get("/api/flights/{flight_id}", response_model=FlightResponse)
    def get_flight(
        flight_id: str,
        flights: FlightService = Depends(get_flight_service),
    ) -> dict[str, Any]:
        record = flights.get_flight(flight_id)
        if not record:
            raise HTTPException(status_code=404, detail=f"Flight {flight_id} not found")
        return record

    @application.delete("/api/flights/{flight_id}")
    def delete_flight(
        flight_id: str,
        flights: FlightService = Depends(get_flight_service),
    ) -> dict[str, bool]:
        success = flights.delete_flight(flight_id)
        if not success:
            raise HTTPException(status_code=404, detail=f"Flight {flight_id} not found")
        return {"deleted": True}

    @application.post("/api/flights/{flight_id}/export-zip")
    def export_flight_zip(
        flight_id: str,
        flights: FlightService = Depends(get_flight_service),
    ):
        try:
            zip_path = flights.export_flight_zip(flight_id)
            if not zip_path.is_file():
                raise HTTPException(status_code=500, detail="ZIP archive could not be generated")
            return FileResponse(
                path=zip_path,
                filename=zip_path.name,
                media_type="application/zip",
            )
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Flight {flight_id} not found")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # --- Isolated Conversion Pipeline & Jobs API ---
    @application.post("/api/convert", response_model=JobResponse, status_code=status.HTTP_202_ACCEPTED)
    async def start_conversion(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        conversion_type: str = Form("auto"),
        db: Database = Depends(get_db),
        tm: TempManager = Depends(get_temp_manager),
        runner: PipelineRunner = Depends(get_pipeline),
    ) -> dict[str, Any]:
        job_id = str(uuid.uuid4())
        filename = file.filename or "staged_input.pdf"
        file_bytes = await file.read()
        file_size = len(file_bytes)

        # Stage file in isolated system temp directory
        staged_path = tm.stage_file(job_id, filename, file_bytes)

        # Create record in SQLite
        job = db.create_job(
            job_id=job_id,
            filename=filename,
            file_size=file_size,
            temp_dir=str(staged_path.parent.parent),
            status="queued",
        )

        # Dispatch background pipeline task
        background_tasks.add_task(
            runner.execute_job_sync,
            job_id,
            staged_path,
            conversion_type,
        )

        return job

    @application.get("/api/jobs", response_model=list[JobResponse])
    def list_jobs(db: Database = Depends(get_db)) -> list[dict[str, Any]]:
        return db.list_jobs()

    @application.get("/api/jobs/{job_id}", response_model=JobResponse)
    def get_job(job_id: str, db: Database = Depends(get_db)) -> dict[str, Any]:
        job = db.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        return job

    @application.post("/api/jobs/{job_id}/discard", response_model=JobDiscardResponse)
    def discard_job(
        job_id: str,
        db: Database = Depends(get_db),
        runner: PipelineRunner = Depends(get_pipeline),
    ) -> dict[str, Any]:
        job = db.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

        runner.discard_job(job_id)
        return {
            "job_id": job_id,
            "status": "discarded",
            "detail": "Temporary folder purged and job discarded",
        }

    @application.get("/api/jobs/{job_id}/download-zip")
    def download_zip(job_id: str, db: Database = Depends(get_db)):
        job = db.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        if job["status"] != "completed":
            raise HTTPException(
                status_code=400,
                detail=f"Job is not completed (current status: {job['status']})",
            )

        zip_path_str = job.get("zip_path")
        if not zip_path_str or not Path(zip_path_str).is_file():
            raise HTTPException(status_code=404, detail="ZIP archive not found on disk")

        zip_path = Path(zip_path_str)
        return FileResponse(
            path=zip_path,
            filename=zip_path.name,
            media_type="application/zip",
        )

    # Legacy click-counter compatibility endpoints
    @application.get("/api/counter", response_model=CounterResponse)
    def read_counter(store: CounterStore = Depends(get_counter_store)) -> CounterState:
        return store.get()

    @application.post("/api/counter/click", response_model=CounterResponse)
    def record_click(store: CounterStore = Depends(get_counter_store)) -> CounterState:
        return store.increment()

    @application.delete("/api/counter", response_model=CounterResponse)
    def clear_counter(store: CounterStore = Depends(get_counter_store)) -> CounterState:
        return store.reset()

    return application


app = create_app()
