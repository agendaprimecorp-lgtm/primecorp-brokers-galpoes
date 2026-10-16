// Conhecimento público da Propto Imóveis para a assistente: planos, teste e perguntas do site propto.com.br.
// Os valores vêm de contas.mjs (fonte única); o texto espelha public/propto.html.
import { PLANOS, TESTE, FUNDADOR, brl } from "./contas.mjs";
import { NUMERO_PROPTO } from "./site.mjs";

export function conhecimentoPropto() {
  const planos = Object.values(PLANOS).map((p) => `- ${p.nome}: ${brl(p.preco)}/mês ou ${brl(p.anual)}/ano · ${p.resumo}`).join("\n");
  return `PROPTO IMÓVEIS (site propto.com.br, use para vendas e dúvidas do cliente)
Produto: app de captação de imóveis no celular do corretor. Câmera guiada por tipo de imóvel, voz com IA que preenche a ficha, leitura e cruzamento de matrícula e IPTU, verificação com índice de 0 a 100 (quadro privado, nunca sai no anúncio), anúncio pronto no fim da visita e envio à estrutura da imobiliária (sistema, site, portais ou pacote pronto). Para: imobiliárias, corretores autônomos e proprietários (sem assinatura, anúncio avulso).
Planos:
${planos}
Teste grátis: ${TESTE.dias} dias, sem cartão. Corretor: ${TESTE.corretor.imoveis} imóveis captados. Imobiliária: ${TESTE.imobiliaria.usuarios} usuários e ${TESTE.imobiliaria.imoveis} imóveis. Cinco dias antes do fim, aviso pelo WhatsApp. Quem assina durante o teste paga ${Math.round(FUNDADOR.desconto * 100)}% a menos por ${FUNDADOR.meses} meses (só no mensal). Se não assinar, a conta fica para consulta e exportação; nada é cobrado sozinho.
Como começar: criar a conta em propto.com.br (botão "Testar grátis por 30 dias"), entrar no app e agendar a implantação de 30 minutos pelo WhatsApp da Propto (+${NUMERO_PROPTO()}).
Perguntas comuns:
- Preciso trocar o sistema da imobiliária? Não. A Propto entrega o imóvel captado ao sistema e ao site que ela já usa.
- A IA inventa informação? Não. O anúncio só afirma o que foi fotografado, dito pelo corretor ou lido em documento; o corretor revisa antes de publicar.
- Dados dos clientes? A imobiliária é dona dos dados, com tratamento conforme a LGPD, e pode exportar tudo.
- Funciona no computador? Sim, em tela larga para o escritório.
- Proprietário sem CRECI pode usar? Pode anunciar o próprio imóvel de forma avulsa. Intermediar imóvel de terceiros é atividade do corretor com CRECI.
- Precisa de cartão? Não, para o teste. Para assinar, o pagamento é por Pix, boleto ou cartão, dentro do app.
Regras para a assistente sobre a Propto: preço só dos planos listados acima; não prometa desconto além do de fundador; para cobrança, cancelamento ou exceção, transfira para a equipe.`;
}
