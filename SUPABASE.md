# Integração do simulador com Supabase

O código está configurado para o projeto `snazkbzpxkutprnxpjfu`. A chave
publishable em `assets/js/config.js` é pública e pode acompanhar o site.
Nunca substitua por uma chave `service_role`, `sb_secret_` ou senha do banco.

## Ativação no painel

1. Abra o projeto Supabase, vá a **SQL Editor**, crie uma consulta e execute
   todo o arquivo `supabase/migrations/001_simulador.sql`.
2. Em **Authentication → Users → Add user**, crie o usuário administrador
   com seu e-mail e senha. A conta usada para entrar no painel Supabase/GitHub
   não cria automaticamente um usuário no Authentication do simulador.
3. No SQL Editor, execute a consulta abaixo trocando o e-mail pelo do usuário
   criado. Confira que o resultado retorna exatamente o usuário desejado:

   ```sql
   insert into public.simulador_admins (user_id)
   select id from auth.users where email = 'SEU_EMAIL'
   on conflict do nothing
   returning user_id;
   ```

4. Sirva a pasta `out` por HTTP/HTTPS. Para testar no computador, a partir
   desta pasta execute `npx --yes http-server . -p 8080 -c-1` e abra
   `http://localhost:8080`. Esse comando baixa o servidor se necessário.
5. Abra **Admin**, entre com o e-mail e senha criados e clique em
   **Publicar conteúdo inicial**. Isso envia as 527 questões, 13 apostilas,
   duas disciplinas extras e três simulados originais. Para recuperar edições
   antigas deste navegador, exporte o backup na versão anterior e importe-o
   em **Admin → Backup**; o carregamento remoto não apaga esse backup local.
6. Abra o site em outra janela anônima. Confira a leitura das questões e
   resumos sem login. Altere um conteúdo no Admin e recarregue a janela anônima
   para verificar que a alteração foi compartilhada.

## Comportamento e segurança

- A leitura do conteúdo é pública. Apenas usuários listados em
  `simulador_admins` podem inserir/atualizar o conteúdo. Usuários comuns não
  podem se promover a administrador pela API. As políticas RLS são aplicadas
  no banco, independentemente das verificações da tela.
- As alterações são publicadas como um documento JSON único, preservando o
  formato existente e permitindo importação em lote e backup atômicos.
- As telas só confirmam sucesso depois que o Supabase aceita a gravação.
  Em caso de falha, os dados em memória voltam ao estado anterior.
- O salvamento via RPC compara a versão carregada. Se outra sessão publicar
  antes, a alteração é recusada; recarregue a página e reaplique a edição.
- A sessão de administrador fica em `sessionStorage`, é renovada quando
  necessário e encerrada pelo botão **Sair**. A antiga senha local não
  autoriza alterações no Supabase.
- Se o banco estiver inacessível ou ainda não configurado, os estudantes
  podem usar os dados originais e veem um aviso; o painel bloqueia edições.
- Os PDFs continuam na pasta `pdfs/`. Esta integração não cria uploads no
  Supabase Storage. Provas, respostas e tentativas continuam na sessão do
  navegador e não são enviadas ao banco.
- Os visitantes carregam o conteúdo ao abrir/recarregar o site; não há
  assinatura Realtime. Não há dependência de CDN ou SDK externo.

## GitHub e publicação

O projeto inclui `vercel.json` e um build sem dependências: `npm run build`
copia apenas HTML, JavaScript, CSS, dados e PDFs para `dist/`. Na Vercel,
importe este repositório com Framework Preset **Other**, Root Directory na
raiz do repositório, Build Command `npm run build` e Output Directory `dist`.
SQL, testes e documentação ficam fora da publicação.

O repositório com o código é `D:\simulador-estatico\out`, remoto
`https://github.com/tiescofernando/SimuladorDeConcurso.git`. A pasta vizinha
`SimuladorDeConcursoPublico` contém apenas um commit inicial com
`.gitattributes` e não é a aplicação.

Vincular a conta Supabase ao GitHub não cria tabelas, não publica o site e não
configura automaticamente o banco no JavaScript. Os arquivos desta integração
precisam ser enviados ao repositório e à hospedagem utilizada. A migração deve
ser executada no projeto antes de publicar o código atualizado.

## Verificação local

```text
node --check assets/js/app.js
node --check assets/js/supabase.js
node --test tests/supabase.test.cjs
```

Os testes usam respostas simuladas para verificar autenticação, renovação,
logout, autorização, conflitos de versão e falhas de conexão. Eles não
substituem o teste real após executar a migração e criar o administrador.
