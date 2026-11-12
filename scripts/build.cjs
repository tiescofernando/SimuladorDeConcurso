// Copia somente os arquivos públicos; SQL, testes e documentação não são publicados.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
for (const name of ['index.html', 'assets', 'data', 'pdfs']) {
  fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true });
}
console.log('Site estático gerado em dist/.');
