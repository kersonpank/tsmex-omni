/** Fronteiras terrestres das 27 UFs. A ordem prioriza o corredor BR-050/153:
 * SP → MG → GO → TO → MA, entre caminhos com o mesmo número de fronteiras.
 * Estimativa fiscal determinística; paradas informadas pelo operador prevalecem. */
export const UF_ADJACENCY: Readonly<Record<string, readonly string[]>> = {
    AC: ['AM', 'RO'], AL: ['PE', 'SE', 'BA'], AP: ['PA'],
    AM: ['AC', 'RO', 'MT', 'PA', 'RR'], BA: ['MG', 'GO', 'TO', 'PI', 'PE', 'AL', 'SE', 'ES'],
    CE: ['PI', 'PE', 'PB', 'RN'], DF: ['GO', 'MG'], ES: ['MG', 'BA', 'RJ'],
    GO: ['TO', 'MG', 'BA', 'MT', 'MS', 'DF'], MA: ['TO', 'PA', 'PI'],
    MT: ['GO', 'MS', 'RO', 'AM', 'PA', 'TO'], MS: ['GO', 'MT', 'MG', 'SP', 'PR'],
    MG: ['GO', 'BA', 'SP', 'MS', 'DF', 'ES', 'RJ'], PA: ['TO', 'MA', 'MT', 'AM', 'RR', 'AP'],
    PB: ['CE', 'RN', 'PE'], PR: ['SP', 'MS', 'SC'], PE: ['PI', 'CE', 'PB', 'AL', 'BA'],
    PI: ['MA', 'TO', 'BA', 'PE', 'CE'], RJ: ['SP', 'MG', 'ES'], RN: ['CE', 'PB'],
    RS: ['SC'], RO: ['AC', 'AM', 'MT'], RR: ['AM', 'PA'], SC: ['PR', 'RS'],
    SP: ['MG', 'MS', 'PR', 'RJ'], SE: ['BA', 'AL'], TO: ['GO', 'MA', 'BA', 'PI', 'PA', 'MT'],
};

export function intermediateUfs(origin: string, destination: string): string[] {
    const start = origin.trim().toUpperCase();
    const end = destination.trim().toUpperCase();
    if (!UF_ADJACENCY[start] || !UF_ADJACENCY[end]) throw new Error('UF de origem ou destino inválida para o percurso do MDF-e.');
    const queue = [[start]];
    const seen = new Set([start]);
    for (let i = 0; i < queue.length; i++) {
        const path = queue[i];
        const current = path[path.length - 1];
        if (current === end) return path.slice(1, -1);
        for (const next of UF_ADJACENCY[current]) {
            if (seen.has(next)) continue;
            seen.add(next);
            queue.push([...path, next]);
        }
    }
    throw new Error('Não foi possível calcular o percurso do MDF-e.');
}

export function resolvePercursoUfs(origin: string, destination: string, stops: string[]): string[] {
    return stops.length
        ? [...new Set(stops.map((uf) => uf.trim().toUpperCase()).filter((uf) => uf && uf !== origin && uf !== destination))]
        : intermediateUfs(origin, destination);
}
