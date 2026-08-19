// Extrai as funcoes puras do painel e testa a janela de 5s + trava de cor
const fs=require("fs");
let src=fs.readFileSync("gui/session/pudim_panel.js","utf8");
function grab(name){
  const i=src.indexOf("function "+name);
  if(i<0) throw new Error("nao achei "+name);
  let d=0,j=src.indexOf("{",i);
  for(let k=j;k<src.length;k++){ if(src[k]==="{")d++; else if(src[k]==="}"){d--; if(d===0) return src.slice(i,k+1);} }
}
const PUDIM_HP_WINDOW=5000, PUDIM_COLOR_HOLD=2000;
let g_PudimHpSamples=[], g_PudimCombatColor="yellow", g_PudimCombatColorSince=0, g_PudimCombatColorPending=null;
eval(grab("pudim_BattleReality"));
eval(grab("pudim_StableColor"));

let fail=0;
const ok=(c,m)=>{ console.log((c?"  ok  ":"FALHA ")+m); if(!c)fail++; };

// --- janela de 5s por HP ---
console.log("== janela de 5s (HP perdido) ==");
ok(pudim_BattleReality(0, 1000, 1000)===null, "1a amostra: sem dados ainda");
ok(pudim_BattleReality(1000, 1000, 1000)===null, "ninguem apanhou -> null (sem sinal falso)");
let r=pudim_BattleReality(2000, 900, 1000);
ok(r!==null && Math.abs(r-1)<1e-9, "so nos sangramos -> 1.0 (vermelho) [r="+r+"]");
g_PudimHpSamples=[];
pudim_BattleReality(0,1000,1000);
r=pudim_BattleReality(2000,1000,900);
ok(Math.abs(r-0)<1e-9, "so ele sangra -> 0.0 (verde) [r="+r+"]");
g_PudimHpSamples=[];
pudim_BattleReality(0,1000,1000);
r=pudim_BattleReality(2000,950,950);
ok(Math.abs(r-0.5)<1e-9, "empate -> 0.5 (amarelo) [r="+r+"]");
// reforco chegando nao pode virar "vitoria"
g_PudimHpSamples=[];
pudim_BattleReality(0,1000,1000);
r=pudim_BattleReality(2000,1200,900);
ok(Math.abs(r-0)<1e-9, "reforco (HP subiu) nao conta como perda [r="+r+"]");
// amostra velha sai da janela
g_PudimHpSamples=[];
pudim_BattleReality(0,1000,1000);
pudim_BattleReality(9000,500,1000);
r=pudim_BattleReality(10000,500,1000);
ok(r===null, "amostra >5s descartada; sem perda nova -> null");

// --- trava de 2s na cor ---
console.log("== trava de 2s antes de trocar de cor ==");
g_PudimCombatColor="yellow"; g_PudimCombatColorPending=null;
ok(pudim_StableColor(0,"red")==="yellow", "pedido de vermelho: ainda amarelo (aguarda)");
ok(pudim_StableColor(1000,"red")==="yellow", "1s depois: ainda amarelo");
ok(pudim_StableColor(2000,"red")==="red", "2s depois: troca para vermelho");
ok(pudim_StableColor(2500,"green")==="red", "novo pedido reinicia a contagem");
ok(pudim_StableColor(3000,"red")==="red", "voltou ao atual: cancela pendente");
ok(pudim_StableColor(9000,"red")==="red", "estavel sem oscilar");
console.log(fail?("\n"+fail+" FALHA(S)"):"\nTODOS OS TESTES PASSARAM");
process.exit(fail?1:0);
