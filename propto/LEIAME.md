# Propto · captação inteligente (SaaS)

Site próprio, separado do app PrimeCorp: banco, arquivos e usuários do Propto nunca se misturam com os da PrimeCorp.

## Publicar (uma vez)
1. Netlify → **Add new project → Import from Git** → este mesmo repositório, com **Base directory = `propto`**. O `netlify.toml` desta pasta já define build, publicação e funções.
2. **Identity** (Project configuration → Identity): ativar; **Registration = Open** (cada cliente cria a própria conta); manter a confirmação de e-mail ligada.
3. **Variáveis de ambiente** (escopo Functions):
   - `ADMIN_EMAILS` = `contato@primecorpconsultoria.com.br,comercial@primecorpconsultoria.com.br`
   - `ASAAS_API_KEY` = chave da conta Asaas da PrimeCorp (sandbox começa com `$aact_hmlg_`, produção com `$aact_prod_`)
   - `ASAAS_AMBIENTE` = `producao` quando sair do teste (vazio = sandbox)
   - `ASAAS_WEBHOOK_TOKEN` = um texto longo aleatório (o mesmo vai no Asaas)
   - `URL_PUBLICA` = `https://propto.com.br`
4. **Asaas → Integrações → Webhooks**: URL `https://propto.com.br/webhook/asaas`, token = `ASAAS_WEBHOOK_TOKEN`, eventos de **Cobranças** (criada, confirmada, recebida, vencida, estornada, chargeback) e de **Assinaturas** (removida/inativada). Em **Notificações**, deixe ligados os lembretes de vencimento e atraso por e-mail/SMS/WhatsApp: são os lembretes ao cliente.
5. **Domínio**: em Domain management do site Propto, adicione `propto.com.br` e `www.propto.com.br` (remova-os do site PrimeCorp, se estiverem lá).
6. Primeiro deploy de produção: ativa o banco (migrations em `netlify/database/migrations`) e o AI Gateway.

## Como funciona
- **Tipos de conta** (escolhidos no cadastro): corretor(a) com CRECI PF, imobiliária com CRECI PJ, proprietário sem CRECI, e membros convidados por uma imobiliária.
- **Planos** (`shared/planos.mjs`): avulso R$ 49,90 (1 captação), autônomo R$ 99,99 (30/mês), imobiliária até 5 R$ 199,99 (150/mês), 6 a 10 R$ 299,99 (300/mês). Mensais só para quem tem CRECI.
- **Cobrança**: Asaas, Pix/boleto/cartão à escolha do cliente. Webhook libera, marca atraso e cancela. Carência de 5 dias; depois, novas captações bloqueadas (anúncios e arquivos continuam acessíveis).
- **CRECI**: não há API pública. O usuário informa número/UF e envia a carteira ou certidão; vocês conferem no site do CRECI e marcam a situação em **Admin**. Pendência: aviso no app, ciência registrada e anúncio sai sem o número do CRECI.
- **Roteiro guiado** (`shared/roteiro.mjs`): fotos obrigatórias e dados por tipo de imóvel; o app só considera completo com tudo preenchido.
- **Entregas**: landing `/a/<token>` (sem endereço), PDF com a marca do usuário, pacote .zip com XML VRSync, CSV, texto e fotos nomeadas.
- **Intermediação**: proprietário pede corretor parceiro; Admin aceita só com a autorização assinada; a landing passa a mostrar o corretor (residencial → Joselia, demais → Rodrigo, ajustável).

## Testes
`npm install`, depois `npm test` (12 testes: regras, cadastro, cobrança, isolamento entre contas, landing, CRECI, equipe, admin).
Telas: `node test/server.mjs` e, em outro terminal, `node test/e2e.mjs` (precisa das fotos de teste em /tmp/claude-0/fotos_teste).

## Antes de vender (pendências fora do código)
- Advogado: revisar `public/termos.html` e preencher o CNPJ.
- Contador: CNAE de licenciamento de software (ex.: 6203-1/00) e emissão de NFS-e pelas vendas do Propto.
- Asaas: conta da PJ aprovada; testar uma cobrança real de R$ 5 no sandbox → produção.
