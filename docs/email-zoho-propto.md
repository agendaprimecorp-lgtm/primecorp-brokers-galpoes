# E-mails Propto no Zoho (plano gratuito) — preparação

Contas a criar: `contato@propto.com.br` e `sac@propto.com.br`.
Status: preparado. Criação das caixas e senhas: feitas pelo Rodrigo no painel Zoho. Ativação no sistema: depois.

## 1. Pré-requisito (DNS, Registro.br)
A verificação do domínio no Zoho depende do TXT de verificação já na zona:
- TXT `@` = `zoho-verification=zb55526153.zmverify.zoho.com`

Ainda não propagou (checado em 16/10/2026, 02:03 UTC; DNS público não consultável pelo proxy desta sessão).

## 2. Registros de e-mail (adicionar só após a verificação do domínio)
| Tipo | Nome | Valor | Prioridade |
|---|---|---|---|
| MX | @ | mx.zoho.com | 10 |
| MX | @ | mx2.zoho.com | 20 |
| MX | @ | mx3.zoho.com | 50 |
| TXT | @ | `v=spf1 include:zoho.com include:amazonses.com ~all` | — |
| TXT | zmail._domainkey | (valor DKIM que o Zoho mostra no painel, não inventar) | — |

Atenção:
- Só pode existir **um** TXT SPF no domínio. Hoje existe `v=spf1 -all` no DNS público e não está na zona editável do Registro.br. Antes de inserir o SPF do Zoho, resolver essa origem.
- O `include:amazonses.com` não é necessário para o Zoho. Retirar se não usar outro serviço; o Resend usa os subdomínios `send` e `rsend`, não o SPF raiz.
- Confirmar os valores de MX e DKIM no painel do Zoho antes de salvar.

## 3. Passo a passo no Zoho (feito por você, com senha definida por você)
1. Zoho Mail → Adicionar domínio → `propto.com.br` → Verificar.
2. Admin → Usuários → Adicionar: `contato` e depois `sac`.
3. Definir senha forte em cada caixa e guardar no gerenciador de senhas. Não enviar senha no chat.
4. Admin → Domínio → DKIM → gerar → copiar o valor para o TXT acima.
5. Admin → Domínio → Verificar MX e SPF.

## 4. Ativação no sistema (depois)
- Resend: confirmar `propto.com.br` como verificado (pendente hoje).
- Variáveis no Netlify: remetente de sistema `contato@propto.com.br`; SAC `sac@propto.com.br`.
- Teste de envio para um endereço externo e checagem de caixa de spam.

## 5. Pendências
- Propagação do TXT de verificação (Registro.br, republicação).
- Origem do SPF `v=spf1 -all` no DNS público.
