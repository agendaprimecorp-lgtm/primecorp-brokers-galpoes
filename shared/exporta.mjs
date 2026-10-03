// Exportação para sistemas de imobiliária: XML no padrão VRSync (Grupo OLX/ZAP), CSV e texto.
import { grupo } from "./roteiro.mjs";

const X = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const int = (v) => { const n = Math.round(Number(String(v ?? "").replace(/\./g, "").replace(",", "."))); return Number.isFinite(n) && n > 0 ? n : null; };

const TIPO_VRSYNC = {
  "Apartamento": "Residential / Apartment", "Casa": "Residential / Home", "Casa em condomínio": "Residential / Condo", "Sobrado": "Residential / Sobrado",
  "Cobertura": "Residential / Penthouse", "Kitnet / studio": "Residential / Kitnet", "Sala comercial": "Commercial / Office", "Loja": "Commercial / Business",
  "Prédio comercial": "Commercial / Building", "Galpão": "Commercial / Industrial", "Galpão em condomínio": "Commercial / Industrial", "Barracão": "Commercial / Industrial",
  "Terreno": "Residential / Land Lot", "Área / terreno": "Commercial / Land Lot", "Fazenda": "Residential / Farm Ranch", "Sítio": "Residential / Farm Ranch", "Chácara": "Residential / Farm Ranch",
};
export const tipoVRSync = (t) => TIPO_VRSYNC[t] || (grupo(t) === "residencial" ? "Residential / Home" : "Commercial / Building");
const transacao = (op) => (/venda/i.test(op || "") && /loca/i.test(op || "") ? "Sale/Rent" : /loca/i.test(op || "") ? "For Rent" : "For Sale");

/** XML VRSync de um imóvel. `fotos` = [{ url, legenda }] (URLs públicas da landing ou nomes de arquivo do ZIP). */
export function xmlVRSync(c, { fotos = [], contato = {}, codigo = "" } = {}) {
  const d = c.dados || {}; const an = c.anuncio || {};
  const tr = transacao(d.operacao);
  const area = int(d.construida) || int(d.terreno) || (d.area_ha ? int(Number(String(d.area_ha).replace(",", ".")) * 10000) : null);
  const tag = (n, v, at = "") => (v === null || v === undefined || v === "" ? "" : `      <${n}${at}>${X(v)}</${n}>\n`);
  const desc = [an.subtitulo, an.descricao, (an.destaques || []).length ? (an.destaques || []).map((x) => "• " + x).join("\n") : ""].filter(Boolean).join("\n\n").slice(0, 3000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ListingDataFeed xmlns="http://www.vivareal.com/schemas/1.0/VRSync" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <Provider>Propto</Provider>
    <Email>${X(contato.email || "")}</Email>
    <ContactName>${X(contato.nome || "")}</ContactName>
    <PublishDate>${new Date().toISOString().slice(0, 19)}</PublishDate>
  </Header>
  <Listings>
    <Listing>
      <ListingID>${X(codigo || c.id)}</ListingID>
      <Title>${X(an.titulo || d.titulo || "")}</Title>
      <TransactionType>${tr}</TransactionType>
      <Details>
${tag("UsageType", ["residencial", "rural"].includes(grupo(d.tipo)) ? "Residential" : "Commercial")}${tag("PropertyType", tipoVRSync(d.tipo))}${tag("Description", desc)}${tr !== "For Rent" ? tag("ListPrice", int(d.venda), ' currency="BRL"') : ""}${tr !== "For Sale" ? tag("RentalPrice", int(d.aluguel), ' currency="BRL" period="Monthly"') : ""}${tag("PropertyAdministrationFee", int(d.condominio), ' currency="BRL"')}${tag("Iptu", int(d.iptu), ` currency="BRL" period="${d.iptu_periodo === "mensal" ? "Monthly" : "Yearly"}"`)}${tag("LivingArea", area, ' unit="square metres"')}${tag("LotArea", int(d.terreno) || (d.area_ha ? int(Number(String(d.area_ha).replace(",", ".")) * 10000) : null), ' unit="square metres"')}${tag("Bedrooms", int(d.dormitorios))}${tag("Bathrooms", int(d.banheiros))}${tag("Suites", int(d.suites))}${tag("Garage", int(d.vagas), ' type="Parking Space"')}${(an.destaques || []).length ? `      <Features>\n${an.destaques.map((x) => `        <Feature>${X(x)}</Feature>`).join("\n")}\n      </Features>\n` : ""}      </Details>
      <Location displayAddress="Neighborhood">
        <Country abbreviation="BR">Brasil</Country>
        <State abbreviation="${X(d.uf || "SP")}">${X(d.uf || "SP")}</State>
        <City>${X(d.cidade || "")}</City>
        <Neighborhood>${X(d.bairro || "")}</Neighborhood>
      </Location>
      <Media>
${fotos.map((f, i) => `        <Item medium="image" caption="${X(f.legenda || "")}"${i === 0 ? ' primary="true"' : ""}>${X(f.url)}</Item>`).join("\n")}
      </Media>
      <ContactInfo>
        <Name>${X(contato.nome || "")}</Name>
        <Email>${X(contato.email || "")}</Email>
        <Telephone>${X(contato.telefone || "")}</Telephone>
      </ContactInfo>
    </Listing>
  </Listings>
</ListingDataFeed>
`;
}

const CSV_CAMPOS = [["codigo", "Código"], ["tipo", "Tipo"], ["operacao", "Operação"], ["cidade", "Cidade"], ["uf", "UF"], ["bairro", "Bairro"], ["titulo", "Título"], ["venda", "Valor de venda"], ["aluguel", "Aluguel"], ["condominio", "Condomínio"], ["iptu", "IPTU"], ["construida", "Área construída/útil (m²)"], ["terreno", "Terreno (m²)"], ["area_ha", "Área (ha)"], ["dormitorios", "Dormitórios"], ["suites", "Suítes"], ["banheiros", "Banheiros"], ["vagas", "Vagas"], ["pe_direito", "Pé-direito (m)"], ["docas", "Docas"], ["energia_kva", "Energia (kVA)"], ["documentacao", "Documentação"], ["disponibilidade", "Disponibilidade"], ["descricao", "Descrição"], ["destaques", "Destaques"], ["fotos", "Fotos"]];

/** CSV (separador ;, padrão do Excel em português). */
export function csvImovel(c, { codigo = "", fotos = [] } = {}) {
  const d = c.dados || {}; const an = c.anuncio || {};
  const v = { ...d, codigo: codigo || c.id, titulo: an.titulo || "", descricao: an.descricao || "", destaques: (an.destaques || []).join(" | "), fotos: fotos.map((f) => f.url).join(" | ") };
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  return "﻿" + CSV_CAMPOS.map((x) => q(x[1])).join(";") + "\r\n" + CSV_CAMPOS.map((x) => q(v[x[0]])).join(";") + "\r\n";
}

/** Texto pronto para colar no sistema da imobiliária ou no portal. */
export function textoImovel(c, { codigo = "" } = {}) {
  const d = c.dados || {}; const an = c.anuncio || {};
  const L = [an.titulo || "", an.subtitulo || "", "", an.descricao || "", ""];
  if ((an.destaques || []).length) { L.push("Destaques:"); an.destaques.forEach((x) => L.push("• " + x)); L.push(""); }
  L.push(`Código: ${codigo || c.id}`, `Tipo: ${d.tipo || ""} · ${d.operacao || ""}`, `Local: ${[d.bairro, d.cidade, d.uf].filter(Boolean).join(", ")}`);
  return L.join("\n");
}

/** Nome de arquivo seguro para fotos do ZIP: 01-sala-1.jpg */
export const nomeFoto = (i, ambiente, n) => `${String(i).padStart(2, "0")}-${String(ambiente || "foto").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${n}.jpg`;
