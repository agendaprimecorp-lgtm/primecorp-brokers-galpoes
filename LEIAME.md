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
| Ficha mínima | Nota de completude por tipo de imóvel (galpão, área, comercial) e perguntas objetivas para o que falta |
| Pedido ao anunciante | Link (Sala do Anunciante) e PDF editável: o anunciante completa os dados e aceita a autorização de indicação com a divisão de honorários |
| Comissão | Honorários por negócio (% da venda ou nº de aluguéis), divisão em 2, 3 ou mais partes, quem recebe e repassa, soma travada em 100% |
| Acordo de divisão | PDF padronizado para todas as partes assinarem (imobiliária, corretor parceiro, PrimeCorp); fica nos Relatórios emitidos |
| Captação no local | Câmera do celular por ambiente, tratamento automático das fotos (luz, cor, nitidez), ditado por voz, IA que nomeia o ambiente e extrai números da fala |
| Anúncio | IA redige título, chamada, descrição e destaques a partir das fotos e falas; página pública `/i/…` para WhatsApp com fotos por ambiente, sem endereço, com contador de visitas |
| Equipe e permissões | Administrador e corretor(a); cada captação fica no nome de quem captou (ficha, autorização e anúncio saem com o CRECI dela/dele) |
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

### 2b. Equipe (Joselia e outras pessoas)
1. No app: **Mais → Equipe e permissões → Cadastrar Rodrigo e Joselia** (ou **+ Pessoa**). Defina a permissão: Administrador ou Corretor(a).
2. Na Netlify: **Identity → Invite users** com o mesmo e-mail (ex.: `comercial@primecorpconsultoria.com.br`). A pessoa cria a própria senha pelo link do convite.
3. Quem está em `ADMIN_EMAILS` é sempre administrador. Os demais entram pela lista da Equipe; "Inativo" corta o acesso na hora.

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

**Sinal verde.** Quando um cliente marca interesse na Sala do Cliente (ou o negócio chega à etapa de interesse) numa oferta de terceiro sem autorização, o Painel mostra o sinal verde. Um toque gera o pedido ao anunciante (perguntas que faltam, termo de parceria v2.1 e comissão padrão) e abre o WhatsApp ou e-mail do anunciante lido no anúncio. Depois da autorização, as fotos do anúncio podem ser guardadas no sistema (uso privado, item 1.1 do termo).

**Captação: roteiro guiado e pacote.** A captação mostra as fotos obrigatórias para o tipo de imóvel e exporta um .zip para sistemas de imobiliária (XML VRSync dos portais ZAP/OLX, planilha CSV, texto e fotos nomeadas).

**Leitura pelo link (todos os segmentos).** Em *Nova oferta*, basta colar o link: o servidor abre a página (até 12 s, 2,5 MB), extrai título, descrição, dados estruturados, texto, **fotos** (sem logos e miniaturas) e **contato do anunciante** (WhatsApp, telefone, e-mail), e a IA reconhece o tipo (casa, apartamento, galpão, terreno, fazenda, sítio…) e preenche os campos do segmento. Proteções: só http/https, sem usuário/senha no link, sem rede interna (localhost, IPs privados, metadados de nuvem), cada redirecionamento é revalidado. Portais grandes às vezes bloqueiam robôs (captcha/403): o app avisa e pede para colar o texto do anúncio, que funciona sempre.

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

### 6b. Antes do primeiro pedido ao anunciante e do primeiro acordo
Em **Mais → Configurações**:
1. Confira a comissão padrão (venda em %, locação em nº de aluguéis) e os modelos de divisão. Já vêm: Imobiliária + PrimeCorp (2 partes, 50/50), Imobiliária + Corretor parceiro + PrimeCorp (3 partes, 50/25/25), Proprietário direto + PrimeCorp e Proprietário direto + Corretor parceiro + PrimeCorp. Ajuste os percentuais e marque "Conferi".
2. Preencha os `[__]` dos dois termos de autorização (parceria com imobiliária/corretor e proprietário) e do acordo de divisão; revise com o advogado e marque as revisões.

Sem isso, o sistema não cria pedido ao anunciante nem emite acordo de divisão.

### 6c. Captação no celular
1. Na primeira foto, o iPhone pede acesso à câmera; no primeiro "Falar", ao microfone e ao reconhecimento de fala. Permita.
2. Se o ditado não funcionar no app instalado na Tela de Início, use o microfone do teclado do iPhone: o texto vai para o mesmo campo.
3. A página do anúncio só é publicada depois da autorização do proprietário (pelo link/PDF ou registrada manualmente, em seu nome).

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
- Out/2026: removidos `dashboard.html`, `app.html`, `login.mts`, `auth-utils.mts` e `zoe-context.mts` (painel de demonstração com senha fixa visível na página e "token" sem assinatura, fora do login oficial). O único login do sistema é o Netlify Identity por convite. Se a senha que estava nesse painel for usada em qualquer outro lugar, troque-a.

## Testes (para desenvolvedor)
`npm install` e depois `npm test` (39 testes de API, permissões, segmentos, documentos e leitura por link, com Postgres local). Telas: `node test/server.mjs` e, em outro terminal, `node test/e2e.mjs`, `e2e2`, `e2e3` (captação) e `e2e4` (Joselia, residencial, rural e leitura por link) e `e2e5` (fotos do link, sinal verde, autorização, roteiro e pacote), `e2e9` (verificação e Zoe) e `e2e10` (documentos por IA e Sala do Anunciante). Reinicie o servidor entre um e2e e outro.

## Módulo de usuários (pré-estruturado, desligado)
A pasta `propto/` guarda o módulo para corretores, imobiliárias e proprietários externos (cadastro por tipo, planos com cobrança Asaas, roteiro guiado, landing, PDF e exportação), com interface PrimeCorp e Tecnologia Propto. Não é publicado agora: quando for a hora, siga `propto/LEIAME.md` (site próprio no Netlify, base directory `propto`, banco separado). O código de roteiro e exportação é compartilhado em `shared/`.

## Acesso da Joselia (e de quem mais entrar na equipe)
1. No app, como administrador: **Mais → Equipe e permissões → Cadastrar Joselia** (ou **+ Pessoa**), com o e-mail `comercial@primecorpconsultoria.com.br`.
2. No Netlify: **Project configuration → Identity → Invite users** com o mesmo e-mail.
3. Ela abre o convite no e-mail, toca no link e cria a própria senha.
Ela entra no mesmo sistema (base de imóveis, briefings e clientes compartilhada), com o perfil de corretora: tudo para operar; sem Configurações, Backup, Equipe e exclusões. O painel abre no foco residencial dela e os documentos saem com o nome e o CRECI dela.

## Registro fotográfico
Captar → **Iniciar registro fotográfico** → escolha o tipo (casa, galpão, barracão, terreno, rural…) → a câmera guia ambiente por ambiente: foto, descrever detalhes por voz, salvar e seguir. No fim, a IA escreve o anúncio e o fluxo continua (autorização, página, pacote).

## Navegação, tipos de imóvel e anúncio pelo computador (out/2026)
- **Voltar**: toda subtela tem o botão "‹ Voltar" no topo. O gesto de voltar do iPhone e o botão voltar do Android seguem a navegação do app (não saem do sistema).
- **Painel de tipos com ícones**: Residencial, Galpões, Comerciais, Terrenos e áreas, Rurais. Novos tipos: Ponto comercial, Lote em condomínio, Área industrial, Área comercial, Haras. O roteiro de fotos se ajusta (ex.: galpão pede prevenção de incêndio e cobertura como opcionais; prédio comercial pede recepção e andar tipo; área industrial pede acesso rodoviário; sítio e chácara pedem lazer; haras pede baias e picadeiro).
- **Visita guiada em uma tela**: no celular, nome do ambiente, câmera, Descrever e Salvar e seguir ficam visíveis sem rolar; as abas somem durante a visita. Botão de galeria na câmera para fotos recebidas.
- **Computador**: "Novo anúncio com fotos recebidas" — mesmo roteiro guiado, mas arrastando as fotos de cada ambiente (do celular, do parceiro, do proprietário). A IA trata luz, cor e nitidez, descreve o ambiente, e a ficha passa pela mesma validação antes de publicar. O que foi feito no celular chega sozinho ao computador; dali sai Ficha PDF e Pacote (XML, planilha, fotos).
- **Próximos passos**: linha do tempo 1-2-3 com ações em ícones (Pedir autorização, Publicar, WhatsApp, Copiar link, Ficha PDF, Pacote, Abrir oferta).

## Verificação do imóvel (out/2026)
Cada oferta tem o cartão **Verificação do imóvel** (privado: nada dele sai no teaser, na sala, no anúncio ou na ficha).
- **Campos**: nº da matrícula, cartório (CRI), inscrição imobiliária (IPTU), CIB, CEP, logradouro, número, complemento, bairro, proprietário e CPF/CNPJ; rural: NIRF e código SIGEF (CAR, CCIR e georreferenciamento continuam no bloco Rural). A leitura por link já tenta extrair matrícula, cartório, inscrição e CEP quando o anúncio cita.
- **Varredura automática** (sem intervenção): ao salvar com CEP, endereço ou CPF/CNPJ alterados, ou no botão **Varrer agora**: CEP nos Correios (BrasilAPI, reserva ViaCEP), posição no mapa (OpenStreetMap) e CNPJ na Receita (BrasilAPI: razão social e situação cadastral). CPF só tem o dígito conferido (não há consulta pública).
- **Matrícula por IA**: envie a certidão ou visualização da matrícula (PDF até 4 MB ou fotos). Em segundo plano a IA lê número, cartório, data da certidão, proprietários, áreas, construção averbada, ônus (hipoteca, alienação fiduciária, penhora, indisponibilidade, usufruto…) e quais foram cancelados; completa os campos vazios e cruza tudo com a oferta.
- **Qualquer documento, a IA identifica** (out/2026): o botão **Enviar documento** aceita matrícula, carnê/certidão de IPTU ou cadastro rural (CCIR, recibo do CAR, ITR, SIGEF). A IA reconhece o tipo e:
  - **IPTU**: lê inscrição, contribuinte, endereço, CEP, áreas de terreno e construída, valor venal e débitos; completa só campos vazios; aponta débitos, área da oferta diferente da prefeitura e — com a matrícula — **construção cadastrada na prefeitura e não averbada** (ou averbada com área menor). Mostra quantas vezes o preço pedido é o valor venal (referência fiscal, não avaliação).
  - **Rural**: lê CAR (e situação), CCIR, NIRF, código INCRA, SIGEF, área, módulos fiscais, reserva legal e APP; aponta CAR pendente/cancelado e área diferente da oferta.
  - Se o documento trouxer CEP ou endereço novos, a varredura pública roda sozinha.
- **Sala do Anunciante pede a documentação** (out/2026): no pedido gerado pelo sinal verde, o anunciante informa nº da matrícula, cartório, inscrição do IPTU e CEP e anexa matrícula/IPTU/CCIR (PDF ou foto, até 6 arquivos de 4 MB). Os arquivos ficam privados, a IA lê em segundo plano e o resultado cai na verificação da oferta; o CEP informado dispara a varredura. A mensagem de WhatsApp do pedido já convida a anexar matrícula e IPTU.
- **Índice de verificação (0–100%) e semáforo**: VERIFICADO (tudo conferido + 7 certidões do vendedor), EM VERIFICAÇÃO, BLOQUEADO (divergência ou ônus impeditivo) ou SEM DADOS.
- **Relatório PDF** de verificação (fica em Relatórios emitidos) e **fontes oficiais em 1 toque** (RI Digital/ONR, CENPROT, CNDT, Receita/PGFN, TJSP, SICAR, SIGEF, CCIR).
- **Limite legal**: a matrícula não tem consulta aberta por API. Ela é emitida no RI Digital (ONR) com login e emolumentos; o sistema lê o PDF que você baixar. Para automatizar também o pedido, dá para plugar depois um robô pago (ex.: Infosimples) com a sua credencial do ONR.

## Zoe · assistente no WhatsApp (out/2026)
A Zoe atende clientes, proprietários, corretores e prefeituras no WhatsApp da PrimeCorp e conversa com a equipe (Rodrigo e Joselia) como secretária.
- **Linhas de conversa**: busca de imóvel (qualifica, registra o briefing, procura na base e mostra só faixas e código), proprietário (registra a oferta "a revisar" e marca a captação no local), corretor/imobiliária (parceria), interesse em anúncio, prefeituras (B2G → reunião com Rodrigo), agenda (marcar, remarcar, cancelar) e reclamação/jurídico/negociação (sempre passa para humano).
- **Regras fixas**: apresenta-se como assistente virtual com aviso LGPD; nunca passa endereço, proprietário, anunciante ou matrícula; não inventa preço nem disponibilidade; não negocia; "HUMANO" transfere na hora; "SAIR" para as mensagens automáticas.
- **Equipe pelo WhatsApp**: números em `ZOE_EQUIPE` falam com a Zoe no modo equipe ("resumo do dia", "agenda de amanhã", "conversas pendentes", "verificação do PC-0009") e recebem os avisos (nova demanda, imóvel oferecido, agendamento, pedido de humano).
- **No app**: Mais → **Zoe** (Conversas · Testar a Zoe · Conhecimento) e Mais → **Agenda**. Ao responder uma conversa, a Zoe pausa nela até você tocar em "Devolver para a Zoe". O simulador não grava nada de verdade.

### Ligar o WhatsApp (uma vez)
1. Use um **número exclusivo** para a Zoe (chip novo ou número fixo). Ele não pode estar ativo no app WhatsApp comum.
2. Em developers.facebook.com: crie um app do tipo **Business**, adicione o produto **WhatsApp**, vincule ao Meta Business da PrimeCorp e registre o número. Gere um **token permanente** (usuário do sistema com permissão `whatsapp_business_messaging`).
3. Em WhatsApp → Configuração → **Webhook**: URL `https://SEU-SITE/whatsapp/webhook`, token de verificação = o valor de `WHATSAPP_VERIFY_TOKEN`; assine o campo **messages**.
4. No Netlify (escopo Functions), cadastre e faça novo deploy:

| Variável | Valor |
|---|---|
| `WHATSAPP_TOKEN` | Token permanente da Meta |
| `WHATSAPP_PHONE_ID` | Phone number ID (não é o número) |
| `WHATSAPP_APP_SECRET` | App Secret do app (confere a assinatura de cada mensagem) |
| `WHATSAPP_VERIFY_TOKEN` | Uma frase sua, igual à do passo 3 |
| `WHATSAPP_NUMERO` | O número para exibir, ex.: (19) 9xxxx-xxxx |
| `ZOE_EQUIPE` | WhatsApp da equipe separados por vírgula (ex.: `19998051985,199xxxxxxxx`) |
| `ZOE_MODELO_AVISO` | Opcional: nome de um modelo aprovado com 1 variável, para avisar a equipe fora da janela de 24 h |
| `COLETA_SEGREDO` | Já existe: protege as funções de segundo plano da Zoe e da matrícula |

5. Mais → Zoe → **Conhecimento**: revise quem somos, serviços, FAQ, horário e duração das reuniões. Teste em **Testar a Zoe** antes de divulgar o número.

Custos: mensagens dentro da janela de 24 h após o cliente escrever não são cobradas pela Meta; modelos (fora da janela) são cobrados por mensagem. A IA da Zoe usa os mesmos créditos do AI Gateway da Netlify.
Testes: `npm test` (57 testes, incluindo 17 de verificação e Zoe) e `node test/e2e9.mjs` com o servidor de teste.


### Número da Zoe: (19) 98110-5192
DDD 19, da região de atuação. Dois caminhos, conforme a situação do chip:
- **Chip sem WhatsApp instalado (recomendado, mais rápido):** registre direto na Cloud API da Meta (passos 1 a 5 acima, modo padrão `meta`). Não precisa de parceiro; o atendimento humano é feito pelo app PrimeCorp (Mais → Zoe → Conversas).
- **Chip já em uso no WhatsApp Business do celular:** coexistência pelo parceiro (seção abaixo). Para usar o caminho direto, apague a conta do WhatsApp nesse chip antes de registrar na Meta.
- `WHATSAPP_NUMERO` = `(19) 98110-5192`. Com ele preenchido, o botão "Tenho interesse" das páginas de anúncio (`/i/…`) abre o WhatsApp da Zoe, e o lead já entra no CRM (desligável em Mais → Zoe → Conhecimento).
- `ZOE_EQUIPE` = `19998051985` (Rodrigo) e o WhatsApp da Joselia. O número da Zoe não entra aqui.

### Coexistência (número continua no app do celular)
O número continua no app WhatsApp Business do celular **e** passa a ser atendido pela Zoe ao mesmo tempo (recurso oficial da Meta, "coexistência"). Requisitos: app WhatsApp Business 2.24.17 ou mais novo, número em uso há mais de 7 dias, Página do Facebook e Meta Business da PrimeCorp com acesso de administrador.
- A Meta só libera a coexistência por um **parceiro oficial** (Tech Provider/BSP). O sistema já fala com a **360dialog** (`WHATSAPP_PROVEDOR=360dialog`); com outro parceiro que entregue acesso direto à Cloud API da Meta, use o modo padrão (`meta`).
- Conexão: no painel do parceiro escolha "conectar número do WhatsApp Business app", faça login no Facebook, escaneie o QR code pelo app do celular e aceite compartilhar o histórico (até 6 meses de conversas individuais; grupos não sincronizam). Mantenha o app aberto até terminar.
- No app do celular ficam desligados: mensagens temporárias, visualização única, localização em tempo real e listas de transmissão. Abra o app pelo menos a cada 14 dias para não desconectar.
- **Você responde pelo celular → a Zoe pausa naquela conversa** (o sistema recebe a cópia da sua mensagem). Sem nova resposta sua em 12 h (ajustável em Mais → Zoe → Conhecimento), ela retoma quando o cliente escrever de novo.
- Mensagens que você manda pelo app continuam grátis; as da Zoe seguem a tabela da Cloud API (respostas dentro da janela de 24 h são gratuitas).

Variáveis no modo 360dialog:

| Variável | Valor |
|---|---|
| `WHATSAPP_PROVEDOR` | `360dialog` |
| `WHATSAPP_TOKEN` | API key do número no painel da 360dialog |
| `WHATSAPP_WEBHOOK_CHAVE` | Frase aleatória com 32+ caracteres |
| `WHATSAPP_NUMERO` | `(19) 98110-5192` |
| `ZOE_EQUIPE` | WhatsApp pessoais de Rodrigo e Joselia (não o número da empresa) |

Depois do deploy: app → Mais → Zoe → **Conectar WhatsApp ao sistema** (o sistema aponta o webhook do número na 360dialog, com a chave num cabeçalho privado). Teste mandando "oi" do seu celular para o número da Zoe.

## Zoe: áudio, botões, modelo e revisão semanal (out/2026)
- **Áudio:** áudios de clientes são baixados (Meta ou 360dialog) e transcritos pelo Gemini via AI Gateway da Netlify (`MODELO_AUDIO`, padrão `gemini-2.5-flash`). A Zoe lê como `[áudio] …`; se falhar, pede para escrever.
- **Botões:** respostas com opções sempre saem como botões tocáveis (também corrige o formato antigo `[A | B]`).
- **Modelo:** padrão `claude-sonnet-5-5` com reserva automática (`claude-sonnet-4-5`, `claude-haiku-4-5`). `MODELO_IA` no Netlify sobrepõe.
- **Revisão semanal:** toda segunda 08:00 (Brasília) a Zoe analisa as conversas da semana e grava sugestões em **Zoe → Revisão**; a equipe recebe aviso no WhatsApp. Nada entra no conhecimento sem **Aprovar** (dá para editar o texto antes). "Revisar agora" roda na hora.

## Identidade Propto Imóveis (out/2026)

- A interface (login, menu, cabeçalho, ícone do app, página pública do anúncio, Sala do Cliente e Sala do Anunciante) usa a marca **Propto Imóveis**: vermelho #CC1B1B (#E8443F no escuro), tinta #0F1720, fundo #F7F8F9, títulos em Sora e texto em Inter.
- Logos em `public/marca/` (horizontal e negativo); ícones do app copiados de `propto/public/icons`.
- Documentos com validade jurídica (fichas, termos, contratos de parceria) **continuam com a marca e o CRECI do corretor** (PrimeCorp/Rodrigo/Joselia). A Propto aparece só como tecnologia. Regra em `docs/MARCA.md`.
- Termos de negócio (participação PrimeCorp na comissão) não mudaram.
- Depois de publicar, no celular: remova o atalho antigo da tela inicial e adicione de novo para pegar o ícone novo.

## Página comercial propto.com.br (out/2026)

- `public/propto.html` é a página de vendas (sem preços): captação guiada, verificação, integração com a imobiliária, públicos (imobiliária, corretor, proprietário), FAQ e cadastro com senha que cria a conta e entra no app (imobiliária/corretor) ou inscrição de proprietário (lead) (corretor: 5 imóveis; imobiliária: 3 usuários e 15 imóveis; aviso 5 dias antes do fim; sem cartão).
- O formulário grava em "Cadastros do site" (coleção site_leads, linha "Propto · teste …"), avisa a equipe e devolve o link do WhatsApp comercial. Número: variável `PROPTO_WHATSAPP` (padrão (19) 99805-1985).
- Para publicar no domínio: adicione propto.com.br e www.propto.com.br em Domain management no Netlify; os redirects do netlify.toml já mostram a página na raiz.
- As contas de teste só devem ser liberadas depois da separação de dados por empresa (multiempresa).
- Teste: `test/e2e11.mjs`.

## Contas Propto: cadastro, teste de 30 dias, planos e cobrança (out/2026)
Clientes da Propto (corretores e imobiliárias) criam a conta sozinhos na página `propto.com.br` e entram direto no app. **Cada conta tem os seus dados separados** (tabela `registros_conta`); a operação da PrimeCorp continua na tabela `registros` e nunca se mistura.

**Como funciona para o cliente**
- Cadastro: nome, imobiliária (se for o caso), CRECI, WhatsApp, e-mail e senha. Sem cartão. O acesso nasce confirmado no Identity, com o papel `propto_cliente`.
- Teste de 30 dias: corretor 1 usuário, 5 imóveis, 3 leituras de documento; imobiliária 3 usuários, 15 imóveis, 3 leituras. Os limites são conferidos no servidor.
- App do cliente: Painel, Captar, Imóveis, CRM e Mais (Plano e assinatura, Equipe, Meu perfil, Anúncios, Ler anúncio por link, Relatórios, Exportar dados). Briefings, Salas, pedidos ao anunciante, Zoe, agenda, B2G, backup e configurações são só da PrimeCorp.
- Anúncio público `/i/…`: com o nome, CRECI e WhatsApp do cliente e da imobiliária dele; nunca com PrimeCorp.
- Planos (mensal/anual): Corretor R$ 197/R$ 1.970 · Imobiliária R$ 490/R$ 4.900 · Imobiliária Plus R$ 890/R$ 8.900. Quem assina o mensal durante o teste tem 40% de desconto por 12 meses e a 1ª cobrança vence no fim do teste. Valores em `shared/contas.mjs` (PLANOS, TESTE, FUNDADOR).
- Situação calculada pelas datas: teste → expirada (só consulta; anúncios no ar por mais 7 dias) · ativa → pagamento pendente (3 dias normais) → só consulta (até 15 dias) → suspensa (anúncios fora do ar) · cancelada (acesso até o fim do período pago).
- Termos: `public/termos-propto.html` (aceite gravado na conta com a versão).

**Operação PrimeCorp**: Mais → **Contas Propto (clientes)**: lista com situação, uso e WhatsApp do responsável; +7 dias de teste, suspender/reativar, pagamento manual (Pix fora do Asaas). Cada conta nova e cada pagamento avisa a equipe pelo WhatsApp da Zoe.

**Rotina diária** (`contas-diario`, 09:10): avisos de fim do teste (5 e 2 dias antes e no fim), atraso, e volta ao preço cheio no fim do desconto de fundador.

### Ligar a cobrança (Asaas)
1. Criar a conta no Asaas no **CNPJ da empresa** e começar pelo **sandbox** (sandbox.asaas.com).
2. Netlify → Environment variables:

| Variável | Valor |
|---|---|
| `ASAAS_API_KEY` | Chave da API (Integrações → Chave de API). Sandbox e produção têm chaves diferentes |
| `ASAAS_AMBIENTE` | `producao` só quando for cobrar de verdade (vazio = sandbox) |
| `ASAAS_WEBHOOK_TOKEN` | Frase aleatória com 32+ caracteres, sem espaços |
| `ADMIN_EMAILS` | **Obrigatório preencher**: `contato@primecorpconsultoria.com.br` (e quem mais for administrador) |
| `PROPTO_WHATSAPP` | WhatsApp do suporte Propto (padrão (19) 99805-1985) |
| `PROPTO_MODELO_TESTE` | Opcional: modelo aprovado na Meta com 2 variáveis (nome, texto) para avisar o cliente do fim do teste |

3. No Asaas: Integrações → Webhooks → novo webhook com URL `https://SEU-SITE/asaas/webhook`, token = `ASAAS_WEBHOOK_TOKEN`, eventos de **Cobranças**, fila ativa.
4. Nota fiscal: configurar a emissão automática de NFS-e no painel do Asaas (dados da prefeitura de Sumaré).
5. Testar no sandbox: criar uma conta pela página, escolher o plano, pagar a fatura de teste no sandbox e ver a conta ficar "Ativa". Depois trocar para a chave de produção e `ASAAS_AMBIENTE=producao`.

Sem `ASAAS_API_KEY`, o botão de assinar mostra "fale com a equipe pelo WhatsApp" e o pagamento pode ser registrado à mão em Contas Propto.

Testes: `node test/contas.mjs` (15 testes: cadastro, isolamento, limites, assinatura, webhook, situação, rotina) e `node test/e2e12.mjs` (cadastro → app do cliente → plano → equipe → limite → painel de contas).

### Domínio propto.com.br (Registro.br → Netlify)
- `propto.com.br` mostra a página comercial; o app fica em **propto.com.br/app** (também funciona em `.netlify.app/app`). O ícone instalado no celular abre `/app`.
- Links de convite e de nova senha que caírem na página comercial são levados para `/app` sozinhos.
- Depois de definir propto.com.br como domínio principal no Netlify, reconectar o WhatsApp (Mais → Zoe → Conectar) para o webhook passar ao endereço novo.

### Boas-vindas por e-mail, instalação no celular e senha (out/2026)
- Ao criar a conta, o cliente recebe um e-mail com o login (e-mail), o link do sistema (`/app`), o site, o passo a passo para instalar no celular e o WhatsApp do suporte. **Nenhum e-mail leva senha**: o envio é bloqueado se o texto tiver "senha:". Corretor incluído pela imobiliária recebe um e-mail de boas-vindas e, à parte, o e-mail do Identity para criar a própria senha.
- Envio pelo Resend (grátis até 3.000 e-mails/mês, 100/dia). Sem a chave, nada é enviado e o cadastro funciona normalmente.

| Variável | Valor |
|---|---|
| `RESEND_API_KEY` | Chave da API do Resend |
| `EMAIL_REMETENTE` | Opcional, padrão `Propto Imóveis <contato@propto.com.br>` (domínio verificado no Resend) |
| `EMAIL_RESPOSTA` | Opcional: e-mail que recebe as respostas dos clientes |
| `PROPTO_SITE` | Opcional, padrão `https://propto.com.br` |

- Verificar o domínio no Resend: criar a conta, adicionar `propto.com.br` em Domains e cadastrar no Registro.br (zona DNS) os registros TXT/MX que o Resend mostrar.
- App: Mais → **Instalar no celular** (Android instala com um toque quando o Chrome permite; iPhone mostra o passo a passo; computador mostra QR). Mais → **Alterar senha** (a troca vai direto ao Identity; a senha não passa pelo nosso servidor).
