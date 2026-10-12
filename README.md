# Flight Simulator · Full-Stack Web Edition

A productionized full-stack web application featuring an interactive 3D flight simulator powered by Three.js and a high-performance FastAPI backend in Python with isolated system temporary folder processing, durable SQLite persistence, pilot logbook with telemetry recording, and a data conversion hub.

---

## Screenshots

### Flight Deck

The 3D cockpit combines runway scenery, classic flight instruments, and a live telemetry recorder.

![Flight Deck with 3D scenery and cockpit instruments](screenshot/flight-deck.png)

### Chase View

Switch to the external chase camera for a view of the aircraft and surrounding scenery.

![External chase view of the aircraft](screenshot/chase-view.png)

### Pilot Flight Logbook

Review recorded flights, performance statistics, ratings, telemetry, and ZIP exports.

![Pilot Flight Logbook with saved flight records](screenshot/flight-logbook.png)

### Data Hub

Upload documents, telemetry, or scenery files and track background conversion jobs.

![Data Hub with file ingestion and conversion history](screenshot/data-hub.png)

---

## Architecture & Project Topology

The application follows the productionization standards defined in `skill/productionization/SKILL.md`:

```text
flight-simulator/
├── original-project/          # Original Flight Simulator scripts & scenery maps (preserved)
├── backend/                   # Python FastAPI backend service
│   ├── app/
│   │   ├── main.py            # FastAPI application entrypoint & API routes
│   │   ├── config.py          # Environment settings & path configurations
│   │   ├── database.py        # SQLite persistence for jobs & flight logbook
│   │   ├── schemas/           # Pydantic schemas (flight, job, scenery)
│   │   ├── services/          # Business logic: pipeline runner, flight service, scenery service
│   │   └── utils/             # TempManager: isolated OS temp folder lifecycle
│   ├── requirements.txt       # Python backend dependencies
│   └── tests/                 # Unit & integration tests
├── frontend/                  # ReactJS Web UI (Vite + TypeScript)
│   ├── src/
│   │   ├── App.tsx            # Main application layout & screen navigation
│   │   ├── components/        # Navigation, FlightSimulator, FlightLogbook, DataHub
│   │   ├── simulator/         # Three.js 3D world, aerodynamics model, audio, SVG instruments
│   │   └── services/          # Frontend API client
│   ├── public/maps/           # Converted scenery maps (Chicago, SF, LA, NYC, Paris, etc.)
│   └── package.json
├── e2e/                       # Playwright end-to-end integration tests
├── screenshot/                # Application screenshots shown in this README
├── setup.py / setup.bat       # Cross-platform automated setup orchestrator
├── run.py / run.bat           # Unified concurrent runner with graceful shutdown
└── secrets.md                 # Security & credential scan audit trail
```

---

## Key Features

### 1. Flight Deck (3D Interactive Cockpit)
- **Flight Physics Engine**: Fixed 60Hz aerodynamics simulation with elevator, aileron, rudder, throttle, flaps, gear, stall, ground rollout, and touchdown physics.
- **Classic Cockpit Instruments**: Crisp SVG dials for Airspeed (with operating arcs), Artificial Horizon (pitch ladder & bank pointer), Altimeter (Kollsman window), Vertical Speed Indicator, and Heading Compass card.
- **Scenery & Runways**: Converted original scenery polygons, buildings, roads, shorelines, and runways across 9 major metropolitan areas (Chicago Meigs Field, San Francisco, Los Angeles, New York, Paris, Munich, Seattle, Champaign, Reno/Stead).
- **Audio Synthesizer**: Web Audio engine roar, stall warning horn, gear/flaps mechanical transitions, touchdown squeal, and impact sounds.
- **Flight Recorder**: Real-time blackbox telemetry recorder capturing 3D flight path, altitude, airspeed, and dynamics with one-click **Save Flight to Logbook**.

### 2. Pilot Flight Logbook
- Persistent SQLite logbook tracking flight sessions, departures, runway alignments, and landing accuracy.
- Pilot scorecards showing vertical touchdown speed (fpm), centerline deviation, rollout distance, and 5-star ratings.
- **Telemetry Explorer**: Interactive telemetry inspection displaying flight dynamics stream.
- **ZIP Export**: Generates and downloads a consolidated flight package containing:
  - `flight_summary.md`: Formatted pilot report
  - `telemetry.json`: High-resolution dynamics stream
  - `flight_track.csv`: Tabular spreadsheet track
  - `flight_path.kml`: 3D trajectory viewable in Google Earth

### 3. Data Hub & Background Conversion Pipeline
- **Multiple Ingestion Modes**: Native file picker, drag-and-drop dropzone, and **Clipboard Paste (`Ctrl+V`)** for PDF documents, scenery containers (`.bgl`), and flight telemetry logs.
- **Isolated Job Storage**: Jobs and exports use `<data_directory>/jobs/<uuid>`, with inputs, work, outputs, and archives kept together. The folder defaults to `%TEMP%/flight-simulator` and can be changed in per-user settings.
- **Active Job Monitor**: 4-stage visual progress timeline, animated percentage progress bar, and collapsible real-time execution log viewer.
- **Lifecycle Controls**: **Continue** active jobs, **Discard & Purge** temporary directories, or **Download ZIP** archives upon completion.

---

## Quick Start

### Windows (PowerShell / Command Prompt)

```powershell
.\setup.bat
.\run.bat
```

### Linux / macOS

```bash
chmod +x setup.sh run.sh
./setup.sh
./run.sh
```

The source runner reads saved ports (defaulting to backend `8000` and frontend `5173`), advances past busy ports, and launches both services concurrently. Both services bind to `0.0.0.0` by default; open one of the printed LAN frontend URLs on another device on the same network. Use `python run.py --host 127.0.0.1` for local-only access. Windows Firewall must allow the services on the network you use.

- **Frontend Application**: <http://localhost:5173>
- **Backend API & Docs**: <http://localhost:8000/docs>

### Per-user settings and storage

Windows settings are saved at `%APPDATA%\flight-simulator\settings.json`. On macOS/Linux, they use `$XDG_CONFIG_HOME/flight-simulator/settings.json` or `~/.config/flight-simulator/settings.json`.

Every launcher creates `{}` if the settings file is absent, fills missing `frontend_port` and `backend_port` from the project's `port_mapping.json`, and rereads the saved ports before starting. Both portable profiles include their own copy of `port_mapping.json`. Existing values and unrelated keys are preserved. Invalid JSON, ports outside `1..65535`, or identical frontend/backend ports stop startup with an error.

The default settings after initialization look like this (the TEMP path is expanded on your computer):

```json
{
  "frontend_port": 5173,
  "backend_port": 8000,
  "data_directory": "C:\\Users\\your-name\\AppData\\Local\\Temp\\flight-simulator"
}
```

Edit `data_directory` to select another folder, such as `D:\FlightData`, and restart the application. The shared `flight_simulator.db` holds the counter, logbook, and job history; conversion files and exports use the chosen folder's `jobs` subfolder. Relative folder paths resolve beside settings.json, and environment variables such as `%USERPROFILE%` are supported. TEMP storage can be cleared by Windows; choose a permanent folder for long-term flight history.

Explicit command-line ports override environment variables, which override saved ports. The checked-in `.env.example` leaves the port and database overrides commented out so settings take effect. `DATABASE_PATH` remains an optional database override, followed by the legacy `COUNTER_DB_PATH`; both leave job storage in `data_directory`.

Existing `data/flight_simulator.db` files and old `%TEMP%/prod_jobs` directories are not moved automatically. To keep the old logbook, set `data_directory` to the old `data` folder or copy the database to your selected folder while the app is stopped. A previously created `.env` containing `DATABASE_PATH`, `FRONTEND_PORT`, or `BACKEND_PORT` still overrides settings; remove those entries to use the saved configuration.

### Portable Windows builds

```powershell
.\build.bat
# Reuse already installed build dependencies:
.\build.bat --skip-install
```

The build installs dependencies, typechecks and builds React, embeds the backend scenery maps in a PyInstaller executable, and creates both packages:

| Folder | Binding | Launcher |
| --- | --- | --- |
| `dist/Debug` | `127.0.0.1`, local access | `dist/Debug/run.bat` |
| `dist/Release` | `0.0.0.0`, LAN access | `dist/Release/run.bat` |

Each package contains `server.exe`, `public/` (including frontend scenery), `run.bat`, `runtime.json`, and `port_mapping.json`. Keep the entire package together. Target computers need neither Python nor Node.js. Both launchers initialize settings before launching the executable, which serves the frontend and backend on the saved ports. Portable builds fail clearly if a configured port is busy; edit settings or close the conflicting service. Both profiles share the same per-user settings and storage.

`.github/workflows/build-release.yml` builds and verifies both Windows x64 packages on pushes to `main` (including PR merges) and manual dispatch. It runs backend and browser tests, uploads ZIPs and SHA-256 checksums, and publishes a timestamped GitHub release after successful verification.

### Differences from sample-react-python-project

The LAN discovery, Debug/Release bindings, portable launcher, port initialization, packaging, and main-branch release workflow follow the sample. Flight Simulator keeps frontend port `5173` instead of the sample portable default `3000`, and uses the application name `flight-simulator`.

Flight Simulator adds the 3D UI, scenery assets, conversion pipeline, and flight logbook. Its single `flight_simulator.db` stores all application records, while the sample uses `counter.db`. All simulator job/export files follow `data_directory`, and a missing `data_directory` is persisted in settings. Backend service initialization remains eager, as in the original simulator; the sample defers initialization to FastAPI lifespan. Existing data is not automatically migrated. Windows is the portable build target; macOS/Linux retain source setup and launch scripts.

Frontend tooling remains on this project's Vite 5 / TypeScript 5 versions; the sample uses Vite 6 / TypeScript 7. The sample's `archive.bat` source-archive helper is not included; the build workflow creates the portable package ZIPs instead.

---

## Controls

| Key | Function |
| :--- | :--- |
| **Arrow Up / Down** | Pitch elevator down / up |
| **Arrow Left / Right** | Bank ailerons left / right |
| **A / D** | Rudder yaw left / right |
| **W / S** | Increase / decrease throttle |
| **G / F** | Toggle landing gear / flaps |
| **C / V** | Toggle Cockpit / Chase external camera view |
| **P / Space** | Pause / resume simulation |
| **R / T** | Restart approach / Runway takeoff start |
| **L / M** | Toggle Daylight / Sunset; Engine sound on / off |
| **H / B** | Open Flight controls / Visual fidelity guide |
| **Escape** | Dismiss active modal or pause |

*Mouse, touch, and pen pointer dragging on the circular yoke joystick and throttle slider are fully supported.*

---

## Verification & Testing

### Backend Unit & Integration Tests

```powershell
.venv\Scripts\python.exe -m unittest discover -s backend\tests -v
```

### Frontend Typecheck & Production Build

```powershell
cd frontend
npm run typecheck
npm run build
```

### Original Scenery Engine Tests

```powershell
cd original-project
npm test
```
