import { runEfreteDiagnostics } from '../services/efrete/efreteDiagnostics.js';

const environment = process.argv[2] === 'producao' ? 'producao' : 'homologacao';
void (async () => {
    const result = await runEfreteDiagnostics(environment);
    console.log(JSON.stringify(result));
    process.exitCode = result.authentication === 'OK' ? 0 : 1;
})();
