// Testa clareamento de cor e a conversao tempo-para-matar -> winChance
const fs=require("fs");
let src=fs.readFileSync("gui/session/pudim_ally_bar.js","utf8");
function grab(n){const i=src.indexOf("function "+n);let d=0,j=src.indexOf("{",i);
 for(let k=j;k<src.length;k++){if(src[k]==="{")d++;else if(src[k]==="}"){d--;if(d===0)return src.slice(i,k+1);}}}
eval(grab("pudim_LightenPlayerColor"));
let fail=0; const ok=(c,m)=>{console.log((c?"  ok  ":"FALHA ")+m); if(!c)fail++;};
const lum=s=>{const[r,g,b]=s.split(" ").map(Number);return 0.2126*r+0.7152*g+0.0722*b;};

console.log("== cor do jogador legivel no fundo escuro ==");
// azul do P1 no 0ad: 10,10,190 -> muito escuro
const azul=pudim_LightenPlayerColor({r:10/255,g:10/255,b:190/255});
ok(lum(azul)>=125,"azul escuro do P1 fica legivel ("+azul+", lum="+lum(azul).toFixed(0)+")");
const verde=pudim_LightenPlayerColor({r:20/255,g:80/255,b:60/255});
ok(lum(verde)>=125,"verde escuro fica legivel ("+verde+")");
// matiz preservado: azul continua predominantemente azul
const [r,g,b]=azul.split(" ").map(Number);
ok(b>r && b>g,"matiz preservado: continua sendo azul");
// cor ja clara nao estoura
const amar=pudim_LightenPlayerColor({r:1,g:1,b:0.2});
ok(amar.split(" ").every(v=>+v<=255),"cor clara nao estoura 255 ("+amar+")");

console.log("== winChance por tempo-para-matar ==");
const wc=(tKillEnemy,tKillUs)=>{
  if(!isFinite(tKillEnemy)&&!isFinite(tKillUs))return 50;
  if(!isFinite(tKillUs))return 95;
  if(!isFinite(tKillEnemy))return 5;
  return Math.max(1,Math.min(99,Math.round(100*tKillUs/(tKillUs+tKillEnemy))));
};
ok(wc(10,10)===50,"tempos iguais = 50%");
ok(wc(5,20)===80,"mato em 5s, morro em 20s = 80%");
ok(wc(20,5)===20,"mato em 20s, morro em 5s = 20%");
ok(wc(10,Infinity)===95,"eles nao me ferem = 95%");
ok(wc(Infinity,10)===5,"nao os firo = 5%");
ok(wc(Infinity,Infinity)===50,"ninguem causa dano = 50%");
console.log(fail?("\n"+fail+" FALHA(S)"):"\nTODOS OS TESTES PASSARAM");
process.exit(fail?1:0);
