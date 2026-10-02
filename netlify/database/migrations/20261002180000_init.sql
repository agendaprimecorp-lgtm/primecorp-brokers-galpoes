-- Registros do CRM (briefings, ofertas, negocios, contatos, salas) em JSONB
CREATE TABLE registros (
  colecao     TEXT        NOT NULL,
  id          TEXT        NOT NULL,
  dados       JSONB       NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluido    BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (colecao, id)
);
CREATE INDEX registros_colecao_idx ON registros (colecao, atualizado_em DESC);

-- Registro imutável de tudo que foi emitido (teaser, PDF, sala, aceite, interesse)
CREATE TABLE emissoes (
  id          BIGSERIAL   PRIMARY KEY,
  codigo      TEXT        NOT NULL,
  tipo        TEXT        NOT NULL,
  negocio_id  TEXT,
  oferta_id   TEXT,
  briefing_id TEXT,
  contato_id  TEXT,
  sala_id     TEXT,
  destinatario TEXT,
  conteudo    TEXT,
  arquivo     TEXT,
  meta        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX emissoes_criado_idx ON emissoes (criado_em DESC);

-- Sequência para códigos PrimeCorp (PC-0001)
CREATE SEQUENCE codigo_pc START 1;
CREATE SEQUENCE codigo_em START 1;
