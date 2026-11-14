// Código do imóvel: PREFIXO-CIDADE-NÚMERO, ex.: GA-COT-001 (galpão em Cotia).
// Espelha a tabela do site (web/assets/carteira.js) e a planilha
// "Códigos dos imóveis PrimeCorp". Mudou aqui, muda lá.
// Sem correspondência, devolve null: código fora da regra não sai do cadastro.

export const CODIGO_TIPO = {
  "apartamento": "AP", "studio": "ST", "kitnet": "KI", "casa": "CA", "casa-condominio": "CC",
  "casa-vila": "CV", "cobertura": "CO", "flat": "FL", "loft": "LO", "sobrado": "SO",
  "galpao": "GA", "centro-distribuicao": "CD", "barracao": "BA", "area-industrial": "AI",
  "loja-ponto": "LJ", "sala-comercial": "SA", "casa-comercial": "CM", "hotel-pousada": "HO",
  "andar-corporativo": "AL", "predio-comercial": "PC", "posto-combustivel": "PO", "garagem": "GR",
  "terreno-urbano": "TU", "terreno-comercial": "TC", "area-comercial": "AC",
  "fazenda": "FA", "sitio": "SI", "chacara": "CH", "gleba-rural": "GL", "haras": "HA",
};

export const CODIGO_CIDADE = {
  "Campinas": "CAM", "Jundiaí": "JUN", "Sumaré": "SUM", "Hortolândia": "HOR",
  "Indaiatuba": "IDT", "Paulínia": "PAU", "Valinhos": "VAL", "Vinhedo": "VIN", "Cotia": "COT",
};

export function gerarCodigo(tipo, cidade, numero) {
  const p = CODIGO_TIPO[tipo], c = CODIGO_CIDADE[cidade];
  if (!p || !c || !(Number(numero) > 0)) return null;
  return `${p}-${c}-${String(Number(numero)).padStart(3, "0")}`;
}
