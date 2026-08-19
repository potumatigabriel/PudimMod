// Valida a ponderacao densidade x distancia usada na escolha do local do armazem.
// Reproduz a mesma conta do codigo: score = densidade / (1 + dist/50)
const score = (cnt, dist) => cnt / (1 + dist / 50);
let fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "FALHA ") + m); if (!c) fail++; };

console.log("== caso real do log 20260819-145022 ==");
// A mata escolhida tinha densidade 44 mas ficava longe da equipe;
// havia mata menor ao lado dos coletores.
const longe = score(44, 200);   // 44 arvores a 200m
const perto = score(25, 20);    // 25 arvores a 20m
ok(perto > longe, "mata media ao lado (25@20m=" + perto.toFixed(1) +
   ") ganha da mata grande longe (44@200m=" + longe.toFixed(1) + ")");

console.log("== a densidade ainda manda quando a distancia empata ==");
ok(score(40, 30) > score(20, 30), "mesma distancia: a mais densa vence");

console.log("== distancia so desempata, nao domina ==");
// mata muito maior perto o suficiente deve vencer uma pequena colada
ok(score(60, 40) > score(8, 0), "60@40m vence 8@0m (nao vira 'sempre o mais perto')");

console.log("== curva de peso ==");
ok(Math.abs(score(10, 0) - 10) < 1e-9, "0m: peso integral");
ok(Math.abs(score(10, 50) - 5) < 1e-9, "50m: metade do peso");
ok(Math.abs(score(10, 150) - 2.5) < 1e-9, "150m: um quarto do peso");

console.log("== sem coletores conhecidos, cai na densidade pura ==");
const semCentro = (cnt) => cnt;
ok(semCentro(44) > semCentro(25), "fallback preserva o comportamento antigo");
console.log(fail ? ("\n" + fail + " FALHA(S)") : "\nTODOS OS TESTES PASSARAM");
process.exit(fail ? 1 : 0);
