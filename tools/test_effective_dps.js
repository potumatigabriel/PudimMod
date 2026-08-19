// Testa pudim_EffectiveDPS e pudim_UnitBucket com mocks do motor
const fs=require("fs");
let src=fs.readFileSync("simulation/components/GuiInterface~pudim.js","utf8");
function grab(n){const i=src.indexOf("function "+n);let d=0,j=src.indexOf("{",i);
 for(let k=j;k<src.length;k++){if(src[k]==="{")d++;else if(src[k]==="}"){d--;if(d===0)return src.slice(i,k+1);}}}

// mocks
const DB={};
global.IID_Attack="A"; global.IID_Resistance="R"; global.IID_Identity="I";
global.Engine={ QueryInterface:(e,iid)=> (DB[e]&&DB[e][iid])||null };
eval(grab("pudim_EffectiveDPS"));
eval(grab("pudim_UnitBucket"));

let fail=0; const ok=(c,m)=>{console.log((c?"  ok  ":"FALHA ")+m); if(!c)fail++;};

// Lanceiro real do jogo: Hack 20, RepeatTime 1000, Bonus Cavalry x2.5
DB[1]={A:{ GetAttackTypes:()=>["Melee"],
           GetAttackEffectsData:()=>({Damage:{Hack:20},Bonuses:{B:{Classes:"Cavalry",Multiplier:2.5}}}),
           GetRepeatTime:()=>1000 }};

console.log("== formula do motor: dano * 0.9^resistencia * bonus ==");
// alvo sem resistencia, 100% infantaria -> 20 dano / 1s = 20 dps
let foe={resist:{Hack:0,Pierce:0,Crush:0},classCount:{Infantry:10},total:10};
ok(Math.abs(pudim_EffectiveDPS(1,foe)-20)<1e-9,"sem resistencia, sem bonus aplicavel = 20 dps");

// resistencia Hack 3 -> 20 * 0.9^3 = 14.58
foe={resist:{Hack:3,Pierce:0,Crush:0},classCount:{Infantry:10},total:10};
ok(Math.abs(pudim_EffectiveDPS(1,foe)-20*Math.pow(0.9,3))<1e-9,"resistencia 3 corta 10% por ponto = "+(20*Math.pow(0.9,3)).toFixed(2));

// 100% cavalaria -> bonus 2.5 integral = 50
foe={resist:{Hack:0,Pierce:0,Crush:0},classCount:{Cavalry:10},total:10};
ok(Math.abs(pudim_EffectiveDPS(1,foe)-50)<1e-9,"100% cavalaria: bonus 2.5x integral = 50 dps");

// 40% cavalaria -> bonus medio ponderado (0.4*2.5 + 0.6*1) = 1.6 -> 32
foe={resist:{Hack:0,Pierce:0,Crush:0},classCount:{Cavalry:4,Infantry:6},total:10};
ok(Math.abs(pudim_EffectiveDPS(1,foe)-32)<1e-9,"40% cavalaria: bonus ponderado 1.6x = 32 dps");

// RepeatTime 2000 deve METADE o dps
DB[2]={A:{GetAttackTypes:()=>["Melee"],GetAttackEffectsData:()=>({Damage:{Hack:20}}),GetRepeatTime:()=>2000}};
foe={resist:{Hack:0,Pierce:0,Crush:0},classCount:{Infantry:10},total:10};
ok(Math.abs(pudim_EffectiveDPS(2,foe)-10)<1e-9,"mesmo dano com RepeatTime 2x = metade do dps (bug antigo!)");

// Capture/Slaughter ignorados
DB[3]={A:{GetAttackTypes:()=>["Capture","Slaughter"],GetAttackEffectsData:()=>({Damage:{Hack:99}}),GetRepeatTime:()=>1000}};
ok(pudim_EffectiveDPS(3,foe)===0,"Capture/Slaughter nao contam como dano de batalha");

console.log("== classes mutuamente exclusivas (sem contagem dupla) ==");
const mk=cl=>({HasClass:c=>cl.includes(c)});
ok(pudim_UnitBucket(mk(["Cavalry","Ranged","Unit"]))==="Cavalry","cavalaria arqueira conta 1x como Cavalry");
ok(pudim_UnitBucket(mk(["Infantry","Melee","Unit"]))==="Infantry","infantaria = Infantry");
ok(pudim_UnitBucket(mk(["Siege","Unit"]))==="Siege","cerco = Siege");
ok(pudim_UnitBucket(mk(["Support","Unit"]))==="Support","suporte = Support");
console.log(fail?("\n"+fail+" FALHA(S)"):"\nTODOS OS TESTES PASSARAM");
process.exit(fail?1:0);
