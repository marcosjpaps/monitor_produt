// Interseção da trajetória com o polígono real, incluindo passagem sem ponto interno.
const {extractLatLng} = require('./telemetryValidator');
function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
function onSegment(a,b,p){return Math.abs(cross(a,b,p))<1e-12 && p[0]>=Math.min(a[0],b[0])-1e-12 && p[0]<=Math.max(a[0],b[0])+1e-12 && p[1]>=Math.min(a[1],b[1])-1e-12 && p[1]<=Math.max(a[1],b[1])+1e-12;}
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];if(onSegment(a,b,p))return true;if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function intersects(a,b,c,d){return onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b)||(cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0);}
function bbox(points){const pts=(points||[]).map(extractLatLng).filter(Boolean);if(!pts.length)return null;return {minLat:Math.min(...pts.map(p=>p[0])),maxLat:Math.max(...pts.map(p=>p[0])),minLng:Math.min(...pts.map(p=>p[1])),maxLng:Math.max(...pts.map(p=>p[1]))};}
function matchFlightToFields(coords,fields){const points=(coords||[]).map(extractLatLng).filter(Boolean);return fields.flatMap(f=>{let ring=f.coords;if(typeof ring==='string')ring=JSON.parse(ring);ring=(ring||[]).map(extractLatLng).filter(Boolean);if(ring.length<3)return [];const hit=points.some(p=>inside(p,ring)) || points.some((p,i)=>i>0 && ring.some((r,j)=>intersects(points[i-1],p,r,ring[(j+1)%ring.length])));return hit?[{talhaoId:f.id,nomeFaz:f.nomeFaz||f.nome_faz||'',talhao:f.talhao||'',coveragePercent:null,matchStatus:'route_intersection'}]:[];});}
module.exports={matchFlightToFields,bbox};
