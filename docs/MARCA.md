# Arquitetura de marca: PrimeCorp Brokers × Propto

**PrimeCorp Brokers** é a marca de serviço: quem atende, assina, negocia e responde pelo CRECI.
**Propto** é a marca de tecnologia: a captação por voz e foto que alimenta o sistema.

Relação: **endosso**, não fusão. Cada marca mantém cor, tipografia e símbolo próprios
(manual Propto: `propto-identidade-visual/docs/MANUAL.md`). Elas se encontram em pontos definidos:

| Onde | Como aparece | Regra do manual Propto respeitada |
|---|---|---|
| Aba **Captar** do app | Símbolo Propto (telhado + três barras da voz) como ícone | Símbolo raso, sem forma em volta (§8.10); vermelho `#CC1B1B` em fundo claro, `#E8443F` no escuro (§4) |
| Botão **Captar imóvel / Nova captação** | Símbolo negativo + "Tecnologia Propto" | Fundo `#141C25 → #0B1118` (tinta Propto), vermelho de fundo escuro |
| Tela de login e menu Mais | "Tecnologia" + logotipo horizontal Propto (100 px) | Tamanho mínimo da horizontal: 100 px (§3) |
| Página pública do imóvel (`/i/…`) | "Anúncio criado com Propto" no rodapé, com link para propto.com.br | Versão positiva sobre papel |
| `propto.com.br` (opcional) | Raiz mostra `propto.html`; `/i/<token>` serve os anúncios | Tokens, Sora 700 / Inter, um vermelho por fundo |

O que **não** se faz: misturar o hexágono PrimeCorp com o símbolo Propto, recolorir o símbolo,
colocar o símbolo dentro de círculo ou caixa, usar Propto em documentos jurídicos (estes são do
corretor e da marca PrimeCorp Brokers).

## Domínio propto.com.br
1. Netlify → Domain management → Add domain alias → `propto.com.br` e `www.propto.com.br`.
2. Apontar o DNS do registro.br para a Netlify (instruções na própria tela).
3. App → Mais → Configurações → **Endereço dos anúncios** = `https://www.propto.com.br`.
Daí em diante os links enviados no WhatsApp saem como `https://www.propto.com.br/i/…`.
