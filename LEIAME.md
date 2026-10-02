# PrimeCorp Brokers · Sistema

Briefings, ofertas, cruzamento, CRM, Sala do Cliente, relatórios emitidos, backup e coleta automática de alertas. Hospedagem, banco de dados, login e IA ficam todos na Netlify.

## O que já vem pronto

| Módulo | O que faz |
|---|---|
| Painel | Indicadores, negócios por etapa, ofertas a revisar e novidades das Salas do Cliente |
| Briefings | Demanda com requisitos; ranking das ofertas com nota de 0 a 100 |
| Ofertas | Leitura do anúncio por IA, checagem com semáforo e código PrimeCorp (PC-0001) |
| CRM | Clientes, parceiros, imobiliárias e proprietários, com histórico e vínculos |
| Sala do Cliente | Link público: cadastro + aceite do termo → opções em faixas → "Tenho interesse" |
| Negócios | Etapas, histórico com data e hora; a ficha PDF só sai a partir de "Termo assinado" |
| Relatórios emitidos | Tudo o que saiu: teaser, ficha PDF (arquivo guardado), sala, aceite, interesse e coleta |
| Backup | Download completo, cópia automática diária (30 dias) e restauração |
| Coleta de alertas | A cada 30 min, lê os e-mails de alerta dos portais e cria ofertas "a revisar" |

## Publicar (uma vez, cerca de 30 minutos)

### 1. Conta e projeto
1. Crie uma conta em netlify.com. O plano gratuito com créditos atende; banco de dados e IA consomem créditos.
2. O código já está no GitHub (privado): `agendaprimecorp-lgtm/primecorp-brokers-galpoes`.
3. Na Netlify: **Add new project → Import an existing project → GitHub** → autorize a conta `agendaprimecorp-lgtm` → escolha `primecorp-brokers-galpoes`. Nome do projeto sugerido: `primecorp-brokers-galpoes`. Não altere nada na tela de build: tudo vem do `netlify.toml`.
4. Faça o primeiro deploy de produção. O banco é criado sozinho e as tabelas entram pela migração em `netlify/database/migrations`.

### 2. Login (Netlify Identity)
1. **Project configuration → Identity → Enable Identity**.
2. Em **Registration**, marque **Invite only**. Ninguém se cadastra sozinho.
3. Em **Identity → Users → Invite users**, convide `contato@primecorpconsultoria.com.br`.
4. Abra o e-mail de convite, toque no link e crie a senha. Pronto.

### 3. Variáveis de ambiente
Em **Project configuration → Environment variables**, com escopo **Functions**:

| Variável | Valor | Obrigatória |
|---|---|---|
| `ADMIN_EMAILS` | `contato@primecorpconsultoria.com.br` | Sim |
| `COLETA_SEGREDO` | Uma frase longa e aleatória (40+ caracteres) | Sim |
| `ALERTAS_IMAP_USER` | O Gmail só de alertas (passo 5) | Para a coleta |
| `ALERTAS_IMAP_SENHA` | A senha de app desse Gmail | Para a coleta |
| `ANTHROPIC_API_KEY` | Sua chave da Anthropic | Opcional (veja o passo 4) |
| `MODELO_IA` | Modelo da IA, se quiser trocar o padrão | Opcional |

Depois de criar ou mudar variáveis, faça um novo deploy.

### 4. IA para ler os anúncios
O AI Gateway da Netlify já entrega a IA da Anthropic às functions **sem chave**, cobrando em créditos Netlify. Ele é ativado no primeiro deploy de produção.
Se preferir pagar direto na Anthropic, cadastre `ANTHROPIC_API_KEY`: a sua chave tem prioridade.

### 5. Coleta automática de alertas
1. Crie um Gmail só para isso (ex.: `alertas.primecorp@gmail.com`).
2. Ative a verificação em duas etapas e gere uma **senha de app** (Conta Google → Segurança → Senhas de app).
3. Cadastre `ALERTAS_IMAP_USER` e `ALERTAS_IMAP_SENHA` e faça um novo deploy.
4. Nos portais, salve as buscas de cada briefing com alerta por e-mail para esse Gmail.

A cada 30 minutos o sistema lê os e-mails não lidos, extrai os anúncios, descarta links repetidos e cria as ofertas como "a revisar". O botão **Mais → Configurações → Coletar agora** força uma coleta.

### 6. Antes da primeira Sala do Cliente
Em **Mais → Configurações**:
1. Preencha os campos `[__]` do termo: prazo de não-contorno e honorários.
2. **Revise o texto com o seu advogado.**
3. Marque "Revisei o termo" e salve.

Enquanto houver `[__]` no texto, o sistema não cria salas.

### 7. No iPhone
Abra o endereço do site no Safari → Compartilhar → **Adicionar à Tela de Início**. O app abre em tela cheia, com o ícone PrimeCorp.

## Checklist depois de publicar
- [ ] Login funciona e `/api/status` mostra o seu e-mail
- [ ] Criar contato, briefing e oferta (extração por IA funcionando)
- [ ] Ajustar o termo e criar uma Sala; abrir o link numa janela anônima, aceitar com um CNPJ real e marcar interesse
- [ ] O negócio aparece em "Interesse"; avance para "Termo assinado" e gere a ficha PDF
- [ ] Mais → Relatórios mostra sala, aceite, interesse e ficha
- [ ] Mais → Backup baixa o arquivo completo
- [ ] No dia seguinte, aparece o primeiro backup automático

## Segurança
- Toda a API exige login, e-mail autorizado (`ADMIN_EMAILS`) e origem do próprio site.
- A Sala do Cliente é a única parte pública. Ela só entrega o nível 1 (faixas) e só depois do aceite. Os identificadores internos das ofertas nunca saem.
- Exclusões não apagam de verdade: o registro fica marcado e continua no backup.
- O site não é indexado por buscadores.

## Testes (para desenvolvedor)
`npm install` e depois `node test/build.mjs && node test/run.mjs`: 18 testes de API, sala e backup com um Postgres local.
