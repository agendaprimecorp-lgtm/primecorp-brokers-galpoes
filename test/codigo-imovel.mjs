import assert from "node:assert/strict";
import { CODIGO_TIPO, CODIGO_CIDADE, gerarCodigo } from "../shared/codigo-imovel.mjs";

const prefixos = Object.values(CODIGO_TIPO);
assert.equal(new Set(prefixos).size, prefixos.length, "prefixos únicos");
assert.ok(prefixos.every((p) => /^[A-Z]{2}$/.test(p)), "prefixo de 2 letras");
const siglas = Object.values(CODIGO_CIDADE);
assert.equal(new Set(siglas).size, siglas.length, "siglas únicas");
assert.ok(siglas.every((c) => /^[A-Z]{3}$/.test(c)), "sigla de 3 letras");
assert.equal(gerarCodigo("galpao", "Jundiaí", 2), "GA-JUN-002");
assert.equal(gerarCodigo("galpao", "Cotia", 1), "GA-COT-001");
assert.equal(gerarCodigo("galpao", "Cotia", 42), "GA-COT-042");
assert.equal(gerarCodigo("inexistente", "Cotia", 1), null, "tipo fora da tabela");
assert.equal(gerarCodigo("galpao", "Itu", 1), null, "cidade fora da tabela");
assert.equal(gerarCodigo("galpao", "Cotia", 0), null, "número inválido");
console.log("codigo-imovel: ok");
