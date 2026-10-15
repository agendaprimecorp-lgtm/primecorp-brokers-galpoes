// Página propto.com.br: depois de criar a conta, entra direto no app com o e-mail e a senha escolhidos.
import { login } from "@netlify/identity";
window.proptoEntrar = async (email, senha) => {
  await login(email, senha);
  location.href = "/app?bemvindo=1";
};
