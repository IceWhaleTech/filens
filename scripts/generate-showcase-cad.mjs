// Generate a fictional cafe plan; no real site or internal drawing is used.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pairs = [];
const add = (...values) => pairs.push(...values);
const line = (x1, y1, x2, y2, layer = 'WALLS') => add(0, 'LINE', 8, layer, 10, x1, 20, y1, 11, x2, 21, y2);
const box = (x, y, w, h, layer = 'FURNITURE') => {
  for (const [a, b, c, d] of [[x,y,x+w,y],[x+w,y,x+w,y+h],[x+w,y+h,x,y+h],[x,y+h,x,y]]) line(a,b,c,d,layer);
};
const circle = (x, y, r, layer = 'FURNITURE') => add(0, 'CIRCLE', 8, layer, 10, x, 20, y, 40, r);
const arc = (x, y, r, start, end) => add(0, 'ARC', 8, 'DOORS', 10, x, 20, y, 40, r, 50, start, 51, end);
const text = (x, y, value, height = 130, layer = 'LABELS') => add(0, 'TEXT', 8, layer, 10, x, 20, y, 40, height, 1, value);
const dim = (x1, x2, y, label) => {
  line(x1,y,x2,y,'DIMENSIONS');
  for (const x of [x1,x2]) {
    line(x,y-160,x,y+180,'DIMENSIONS');
    line(x-65,y-65,x+65,y+65,'DIMENSIONS');
  }
  text((x1+x2)/2-220,y+90,label,130,'DIMENSIONS');
};
add(0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1015',9,'$INSUNITS',70,4,0,'ENDSEC');
add(0,'SECTION',2,'TABLES',0,'TABLE',2,'LAYER',70,7);
for (const [name,color] of [['WALLS',7],['WINDOWS',4],['DOORS',8],['FURNITURE',30],['PLANTS',3],['DIMENSIONS',8],['LABELS',7]]) add(0,'LAYER',2,name,70,0,62,color,6,'CONTINUOUS');
add(0,'ENDTAB',0,'ENDSEC',0,'SECTION',2,'ENTITIES');
// Double perimeter walls, with an entrance and two window openings.
for(const inset of [0,120]){
  const right=9600-inset,top=6200-inset;
  line(inset,top,right,top); line(right,inset,right,top);
  line(inset,inset,4200,inset); line(5400,inset,right,inset);
  line(inset,inset,inset,1000); line(inset,2200,inset,4200); line(inset,5400,inset,top);
}
for(const y of [1000,4200]){box(0,y,120,1200,'WINDOWS');line(60,y,60,y+1200,'WINDOWS');}
line(4200,120,4200,1320,'DOORS'); arc(4200,120,1200,0,90);
text(4420,420,'ENTRY',130);
// Service zone, preparation counter, sink, storage and a compact restroom.
box(6900,120,2580,1780,'WALLS');
box(7050,270,550,420); circle(8590,700,230); box(8310,940,560,420);
text(7850,1510,'WC',160);
box(6900,2100,800,2550); box(7900,5000,1450,950);
box(8050,5200,500,450); circle(8930,5500,150);
text(6970,4700,'COUNTER',130); text(7840,4650,'PREP / STORAGE',130);
for(const y of [2450,3100,3750]){circle(6500,y,200);line(6500,y-110,6500,y+110);}
// Round tables and seats.
for(const [x,y] of [[1550,1650],[1550,3650],[3950,2300],[4300,4400]]){
  circle(x,y,440); circle(x,y,400);
  for(const [dx,dy] of [[0,720],[0,-720],[-720,0],[720,0]]) box(x+dx-150,y+dy-150,300,300);
}
box(550,5540,5200,420);
for(const x of [1400,3100,4800]){box(x-400,4920,800,450);box(x-155,4480,310,310);}
for(const [x,y] of [[600,5800],[5850,5700],[9100,2500]]){
  circle(x,y,240,'PLANTS');
  for(const angle of [0,60,120,180,240,300]){const a=angle*Math.PI/180;circle(x+Math.cos(a)*110,y+Math.sin(a)*110,100,'PLANTS');}
}
text(2850,5600,'WINDOW BENCH',130);
text(2450,3300,'CAFE / 24 SEATS',160);
dim(0,9600,6900,'9600');dim(0,6900,6500,'6900');dim(6900,9600,6500,'2700');
line(-650,0,-650,6200,'DIMENSIONS');
for(const y of [0,6200]){line(-820,y,-450,y,'DIMENSIONS');line(-720,y-70,-580,y+70,'DIMENSIONS');}
text(-1500,3000,'6200',140,'DIMENSIONS');
line(10100,4600,10100,5700,'DIMENSIONS');line(10100,5700,9920,5370,'DIMENSIONS');line(10100,5700,10280,5370,'DIMENSIONS');text(10020,5870,'N',220);
box(0,-1700,9600,1000,'WALLS');line(6400,-1700,6400,-700);line(6400,-1200,9600,-1200);
text(250,-1120,'FIELD NOTES / CAFE',290);text(250,-1490,'FICTIONAL CONCEPT FLOOR PLAN',150);
text(6650,-1000,'PLAN  A-01',180);text(6650,-1510,'UNITS mm / SCALE 1:100',150);
add(0,'ENDSEC',0,'EOF');
await writeFile(path.join(root,'apps/demo/public/samples/filens-cafe.dxf'),`${pairs.join('\n')}\n`);
console.log('Generated fictional cafe floor plan.');
