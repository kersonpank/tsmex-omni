import assert from 'node:assert/strict';
import { it } from 'node:test';
import { intermediateUfs, resolvePercursoUfs, UF_ADJACENCY } from './ufPercurso.js';

it('SP–MA usa o corredor MG, GO, TO de forma determinística', () => {
    assert.deepEqual(intermediateUfs('SP', 'MA'), ['MG', 'GO', 'TO']);
});
it('UFs vizinhas ou iguais não têm intermediárias', () => {
    assert.deepEqual(intermediateUfs('SP', 'RJ'), []);
    assert.deepEqual(intermediateUfs('SP', 'SP'), []);
});
it('paradas manuais prevalecem, sem incluir origem/destino ou duplicatas', () => {
    assert.deepEqual(resolvePercursoUfs('SP', 'MA', ['MG', 'BA', 'PI', 'MA', 'PI']), ['MG', 'BA', 'PI']);
});
it('grafo contém 27 UFs, fronteiras simétricas e alcança todos os pares', () => {
    assert.equal(Object.keys(UF_ADJACENCY).length, 27);
    for (const [origin, neighbors] of Object.entries(UF_ADJACENCY)) {
        for (const neighbor of neighbors) assert.ok(UF_ADJACENCY[neighbor].includes(origin), `${origin}/${neighbor}`);
        for (const destination of Object.keys(UF_ADJACENCY)) {
            const path = [origin, ...intermediateUfs(origin, destination), destination];
            if (origin !== destination) for (let i = 1; i < path.length; i++) assert.ok(UF_ADJACENCY[path[i - 1]].includes(path[i]));
        }
    }
});
it('UF desconhecida falha antes de chamar o provedor', () => {
    assert.throws(() => intermediateUfs('XX', 'MA'), /UF.*inválida/);
});
