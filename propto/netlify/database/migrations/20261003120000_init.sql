-- Propto: contas (multiusuário), captações, anúncios publicados, pagamentos e pedidos de intermediação.
CREATE TABLE contas (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  org_id        TEXT NOT NULL,              -- conta que paga o plano (ela mesma ou a imobiliária)
  dados         JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX contas_org_idx ON contas (org_id);

CREATE TABLE convites (
  email      TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE captacoes (
  id            TEXT PRIMARY KEY,
  conta_id      TEXT NOT NULL,
  org_id        TEXT NOT NULL,
  codigo        TEXT NOT NULL,
  dados         JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluido      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX captacoes_org_idx ON captacoes (org_id, criado_em DESC);
CREATE INDEX captacoes_conta_idx ON captacoes (conta_id, criado_em DESC);

CREATE TABLE anuncios (
  token      TEXT PRIMARY KEY,
  captacao_id TEXT NOT NULL UNIQUE,
  org_id     TEXT NOT NULL,
  dados      JSONB NOT NULL,
  ativo      BOOLEAN NOT NULL DEFAULT TRUE,
  visitas    INTEGER NOT NULL DEFAULT 0,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Eventos do Asaas já processados (idempotência) e histórico financeiro
CREATE TABLE pagamentos (
  id         TEXT PRIMARY KEY,               -- id do evento do webhook
  org_id     TEXT,
  evento     TEXT NOT NULL,
  dados      JSONB NOT NULL,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pagamentos_org_idx ON pagamentos (org_id, criado_em DESC);

-- Proprietários sem CRECI que pedem a intermediação da PrimeCorp
CREATE TABLE intermediacoes (
  id          TEXT PRIMARY KEY,
  conta_id    TEXT NOT NULL,
  captacao_id TEXT NOT NULL,
  dados       JSONB NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE codigo_prp START 1;
