-- Contas de clientes da Propto (corretores e imobiliárias): cada conta tem os seus dados separados.
CREATE TABLE contas (
  id            TEXT        PRIMARY KEY,
  dados         JSONB       NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Registros de cada conta (mesmo formato de "registros", mas sempre filtrados pela conta)
CREATE TABLE registros_conta (
  conta         TEXT        NOT NULL REFERENCES contas(id),
  colecao       TEXT        NOT NULL,
  id            TEXT        NOT NULL,
  dados         JSONB       NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluido      BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (conta, colecao, id)
);
CREATE INDEX registros_conta_idx ON registros_conta (conta, colecao, atualizado_em DESC);

-- Consumo por conta e período (imóveis captados, documentos lidos, chamadas de IA)
CREATE TABLE uso_conta (
  conta   TEXT NOT NULL,
  recurso TEXT NOT NULL,
  periodo TEXT NOT NULL,
  n       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conta, recurso, periodo)
);

-- Eventos de cobrança recebidos (idempotência do webhook do Asaas)
CREATE TABLE cobranca_eventos (
  id        TEXT        PRIMARY KEY,
  conta     TEXT,
  evento    TEXT        NOT NULL,
  dados     JSONB       NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Emissões passam a saber de qual conta são (NULL = PrimeCorp)
ALTER TABLE emissoes ADD COLUMN conta TEXT;
CREATE INDEX emissoes_conta_idx ON emissoes (conta, criado_em DESC);
