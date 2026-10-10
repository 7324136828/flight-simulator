import * as THREE from 'three';

export async function loadManifest() {
  const response=await fetch('/maps/manifest.json');
  if(!response.ok)throw new Error(`Map catalog could not load (${response.status})`);
  return response.json();
}
export async function loadMap(entry) {
  const response=await fetch(`/maps/${entry.file}`);
  if(!response.ok)throw new Error(`Scenery could not load (${response.status})`);
  const map=await response.json();
  if(map.version!==1||!Array.isArray(map.runways)||!map.runways.length)throw new Error('Unsupported map data');
  return map;
}

// Scenery is in east/north metres. Flight coordinates are aligned with the selected
// runway: z=0 at its approach threshold, x positive to the pilot's right.
export function runwayFrame(runway) {
  const angle=runway.heading*Math.PI/180,sin=Math.sin(angle),cos=Math.cos(angle);
  const east=runway.east-sin*runway.length/2,north=runway.north-cos*runway.length/2;
  return {
    toFlight(e,n) { const de=e-east,dn=n-north;return [de*cos-dn*sin,de*sin+dn*cos]; },
    toMap(x,z) { return [east+x*cos+z*sin,north-x*sin+z*cos]; },
    heading:angle,
  };
}

const colors={water:0x397b93,grass:0x74926a,land:0xa4a17f,sand:0xc4ab7d,
  asphalt:0x414d58,concrete:0xb4b6af,urban:0x939c91,building:0xa4b6bb,stone:0xb3b1a1,brick:0xac8070,line:0xc1bd99,road:0x68737a,taxiway:0x737b7d,river:0x397b93};
const layers={water:.03,land:.06,grass:.07,sand:.06,urban:.09,concrete:.13,asphalt:.16};
// Ground colors form an ordered pass before opaque scenery/aircraft. The base
// still writes depth for solid objects, but ground decals must neither read nor
// write it: a grazing view can otherwise reject patches against the huge base.
const groundOrder={water:0,river:0,land:1,sand:2,grass:3,urban:4,stone:5,brick:6,building:7,concrete:8,asphalt:9};
const surfaceOrder={base:-1000,terrain:-900,photoWater:-700,photoLand:-690,photoHole:-680,roads:-650,runway:-600,markings:-590,labels:-580};

function triangles(points) {
  // Project onto the face's dominant plane before ear clipping, including walls.
  const normal=new THREE.Vector3();
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    normal.x+=(a[1]-b[1])*(a[2]+b[2]);
    normal.y+=(a[2]-b[2])*(a[0]+b[0]);
    normal.z+=(a[0]-b[0])*(a[1]+b[1]);
  }
  const n=[Math.abs(normal.x),Math.abs(normal.y),Math.abs(normal.z)],axis=n.indexOf(Math.max(...n));
  const axes=axis===0?[1,2]:axis===1?[0,2]:[0,1];
  return THREE.ShapeUtils.triangulateShape(points.map(p=>new THREE.Vector2(p[axes[0]],p[axes[1]])),[]);
}

function faceKey(points) {
  const vertices=points.map(point=>point.join(','));
  if(vertices[0]===vertices.at(-1))vertices.pop();
  // Equivalent closed boundaries may start at any vertex or have opposite
  // winding. Preserve the edges; sorting vertices would merge different faces.
  const rotations=[];
  for(const sequence of [vertices,vertices.toReversed()])for(let i=0;i<sequence.length;i++) {
    rotations.push([...sequence.slice(i),...sequence.slice(0,i)].join('|'));
  }
  return rotations.sort()[0];
}

export function createScenery(map,selected) {
  const group=new THREE.Group(), frame=runwayFrame(selected),datum=selected.altitude-map.elevation,batches=new Map();
  const materials=new Map();
  const material=(style,decal=false)=>{
    const key=`${style}:${decal}`;
    if(!materials.has(key)) materials.set(key,style==='water'||style==='river'
      ? new THREE.MeshPhysicalMaterial({color:0x215d78,roughness:.38,metalness:.03,clearcoat:.25,side:THREE.DoubleSide,depthWrite:!decal,depthTest:!decal})
      : new THREE.MeshStandardMaterial({color:colors[style]||colors.land,roughness:style==='building'?.55:.95,
        metalness:style==='building'?.08:0,side:THREE.DoubleSide,depthWrite:!decal,depthTest:!decal}));
    return materials.get(key);
  };
  const local = ([east,height,north])=>{const [x,z]=frame.toFlight(east,north);return [-x,height-datum,z];};
  const append=(points,style,order=0,indices=triangles(points))=>{
    const key=`${style}:${order}`;
    if(!batches.has(key))batches.set(key,{style,order,positions:[]});
    const array=batches.get(key).positions;for(const tri of indices)for(const index of tri)array.push(...points[index]);
  };
  const faces=new Map();
  for(const [index,polygon] of map.polygons.entries()) {
    const points=polygon.points.map(local);
    const ys=points.map(p=>p[1]),flat=Math.max(...ys)-Math.min(...ys)<1;
    // Classify in source coordinates. Choosing a runway at another elevation
    // translates the terrain; it must not turn ground patches into solid faces.
    const grounded=flat&&Math.abs(polygon.points[0][1])<3;
    // Original calls repeat some solid faces, occasionally with another style.
    // Keep the final source face so exact duplicate roofs/walls cannot z-fight.
    faces.set(grounded?`ground:${index}`:faceKey(points),{polygon,points,grounded});
  }
  for(const {polygon,points,grounded} of faces.values()) {
    if(grounded)for(const p of points)p[1]=(layers[polygon.style]??.18)-datum;
    const order=grounded?surfaceOrder.terrain+Math.max(0,Math.min(100,polygon.layer||0))+(groundOrder[polygon.style]??10):0;
    append(points,polygon.style,order);
  }
  for(const line of map.lines) {
    for(let i=1;i<line.points.length;i++) {
      const a=local(line.points[i-1]),b=local(line.points[i]),dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
      if(length<.01)continue;
      const w=Math.max(line.width,1)/2,nx=-dz/length*w,nz=dx/length*w;
      const grounded=['road','river','taxiway'].includes(line.style);
      const startGrounded=grounded||Math.abs(line.points[i-1][1])<3;
      const endGrounded=grounded||Math.abs(line.points[i][1])<3;
      const height = startGrounded?.2-datum:a[1]+.1;
      const endHeight = endGrounded?.2-datum:b[1]+.1;
      const order=startGrounded&&endGrounded?surfaceOrder.roads+(line.style==='river'?0:1):0;
      append([[a[0]+nx,height,a[2]+nz],[a[0]-nx,height,a[2]-nz],[b[0]-nx,endHeight,b[2]-nz],[b[0]+nx,endHeight,b[2]+nz]],line.style,order,[[0,1,2],[0,2,3]]);
    }
  }
  for(const tile of map.photoLandcover||[]) {
    const [minE,minN,maxE,maxN]=tile.bounds;
    append([[minE,tile.elevation,minN],[maxE,tile.elevation,minN],[maxE,tile.elevation,maxN],[minE,tile.elevation,maxN]].map(local).map(p=>[p[0],p[1]+.23,p[2]]),'water',surfaceOrder.photoWater);
    for(const contour of tile.contours) {
      const points=contour.points.map(([e,n])=>local([e,tile.elevation+(contour.hole?.31:.28),n]));
      append(points,contour.hole?'water':'grass',contour.hole?surfaceOrder.photoHole:surfaceOrder.photoLand);
    }
  }
  for(const {style,order,positions} of batches.values()) {
    const mat=material(style,order<0);
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    if(['building','brick'].includes(style)) {
      const uv=[];
      for(let i=0;i<positions.length;i+=3)uv.push((positions[i]+positions[i+2])/12,positions[i+1]/9);
      geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
      if(!mat.map)mat.map=facadeTexture(style);
    }
    geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,mat);mesh.receiveShadow=true;mesh.renderOrder=order;
    mesh.castShadow=order===0&&['building','brick','stone'].includes(style);group.add(mesh);
  }
  // A neutral base fills areas for which the legacy world grid is not decoded.
  // Shorter triangles reduce interpolation error when rotating over a plane
  // whose original two triangles each spanned hundreds of kilometres.
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(600000,600000,64,64),material('land'));
  ground.rotation.x=-Math.PI/2;ground.position.y=-.12;ground.receiveShadow=true;ground.renderOrder=surfaceOrder.base;group.add(ground);
  const lights=new THREE.Group(),lightGeometry=new THREE.SphereGeometry(.7,6,4),lightMaterial=new THREE.MeshBasicMaterial({color:0xffeac1});
  for(const r of map.runways) {
    // Draw every recovered runway near the selected field, with its real heading.
    const [x,z]=frame.toFlight(r.east,r.north);
    if(Math.hypot(x,z)>90000)continue;
    const field=new THREE.Group();field.position.set(-x,r.altitude-selected.altitude+.35,z);
    field.rotation.y=-(r.heading-selected.heading)*Math.PI/180;
    drawRunway(field,r,material('asphalt',true),material('concrete',true));
    group.add(field);
  }
  // Recovered point lights are batched as points rather than individual meshes.
  if(map.lights.length) {
    const geometry=new THREE.BufferGeometry().setFromPoints(map.lights.map(l=>new THREE.Vector3(...local(l.point))));
    group.add(new THREE.Points(geometry,new THREE.PointsMaterial({color:0xffe9b7,size:1.5,sizeAttenuation:true})));
  }
  for(let z=0;z<=selected.length;z+=65)for(const x of [-selected.width/2-2,selected.width/2+2]) {
    const lamp=new THREE.Mesh(lightGeometry,lightMaterial);lamp.position.set(x,.8,z);lights.add(lamp);
  }
  group.add(lights);
  return {group,frame,destroy(){
    const geometries=new Set(),mats=new Set(),textures=new Set();
    group.traverse(item=>{if(item.geometry)geometries.add(item.geometry);if(item.material)for(const m of Array.isArray(item.material)?item.material:[item.material]){mats.add(m);if(m.map)textures.add(m.map);}});
    geometries.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
  }};
}

function facadeTexture(style) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const ctx=canvas.getContext('2d');ctx.fillStyle=style==='brick'?'#d3c5b1':'#d6e1dc';ctx.fillRect(0,0,512,512);
  for(let y=20;y<512;y+=64)for(let x=14;x<512;x+=64) {
    ctx.fillStyle=style==='brick'?'#655c56':'#527886';ctx.fillRect(x,y,35,39);
    ctx.fillStyle='#8babb2';ctx.fillRect(x+2,y+2,31,3);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;return texture;
}

function drawRunway(group,runway,asphalt,white) {
  const plane=(width,length,x,z,y,mat,order=surfaceOrder.markings)=>{
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,length),mat);mesh.rotation.x=-Math.PI/2;
    mesh.position.set(x,y,z);mesh.receiveShadow=true;mesh.renderOrder=order;group.add(mesh);return mesh;
  };
  const half=runway.length/2,width=runway.width;
  plane(width,runway.length,0,0,0,asphalt,surfaceOrder.runway);
  for(const x of [-width/2+1,width/2-1])plane(.6,runway.length,x,0,.02,white);
  for(let z=-half+70;z<half-70;z+=100)plane(Math.min(2,width*.04),36,0,z,.025,white);
  for(const end of [-1,1]) {
    for(let x=-width*.37;x<width*.38;x+=width*.14)plane(width*.06,28,x,end*(half-22),.03,white);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#f5f3e7';ctx.font='900 275px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(runway.numbers[end===-1?0:1],256,256);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
    // Cut out the canvas background in the opaque ground pass. Transparent
    // labels would render after the aircraft and buildings, breaking occlusion.
    const label=plane(width*.75,width,0,end*(half-85),.04,new THREE.MeshBasicMaterial({map:texture,alphaTest:.1,alphaToCoverage:true,depthWrite:false,depthTest:false}),surfaceOrder.labels);
    if(end===1)label.rotation.z=Math.PI;
  }
  for(const x of [-width*.28,width*.28])plane(width*.1,38,x,-half+Math.min(280,runway.length*.25),.025,white);
}

export function drawMinimap(canvas,map,selected) {
  const ctx=canvas.getContext('2d'),width=600,height=300;canvas.width=width;canvas.height=height;
  const frame=runwayFrame(selected),scale=height/13000;
  const point=(e,n)=>{const[x,z]=frame.toFlight(e,n);return [width/2+x*scale,height*.56-z*scale];};
  ctx.fillStyle='#192c32';ctx.fillRect(0,0,width,height);
  for(const polygon of map.polygons) {
    if(!['water','grass','land','urban','concrete','asphalt'].includes(polygon.style))continue;
    ctx.beginPath();polygon.points.forEach(([e,,n],i)=>{const[x,y]=point(e,n);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();
    ctx.fillStyle=`#${(colors[polygon.style]||colors.land).toString(16).padStart(6,'0')}`;ctx.globalAlpha=.55;ctx.fill();
  }
  ctx.globalAlpha=1;
  for(const tile of map.photoLandcover||[]) {
    const [minE,minN,maxE,maxN]=tile.bounds, a=point(minE,minN),b=point(maxE,maxN);
    ctx.fillStyle='#285a70';ctx.fillRect(Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1]));
    for(const contour of tile.contours) {
      ctx.beginPath();contour.points.forEach(([e,n],i)=>{const[x,y]=point(e,n);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();
      ctx.fillStyle=contour.hole?'#285a70':'#658663';ctx.fill();
    }
  }
  for(const r of map.runways) {
    const heading=r.heading*Math.PI/180,half=r.length/2;
    const a=point(r.east-Math.sin(heading)*half,r.north-Math.cos(heading)*half),b=point(r.east+Math.sin(heading)*half,r.north+Math.cos(heading)*half);
    ctx.strokeStyle=r.id===selected.id?'#e3f2d4':'#7f9897';ctx.lineWidth=r.id===selected.id?3:1.5;
    ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();
  }
  ctx.setLineDash([5,6]);ctx.strokeStyle='#89d8bb';ctx.beginPath();ctx.moveTo(width/2,height*.56);ctx.lineTo(width/2,height);ctx.stroke();ctx.setLineDash([]);
  return {x:100,y:56,scale:scale/3};
}
