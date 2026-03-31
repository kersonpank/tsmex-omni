/**
 * Corrige usuários com roles vazio.
 * Infere roles a partir das relações: admin, client, link, hubId.
 * Executar: npx ts-node prisma/fix-empty-roles.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const allUsers = await prisma.user.findMany({
    include: {
      admin: true,
      client: true,
      link: true,
    },
  });
  const users = allUsers.filter(u => !u.roles || u.roles.length === 0);

  if (users.length === 0) {
    console.log('Nenhum usuário com roles vazio encontrado.');
    return;
  }

  console.log(`Encontrados ${users.length} usuário(s) com roles vazio.`);

  for (const user of users) {
    const inferred: string[] = [];
    if (user.admin) inferred.push('ADMIN');
    if (user.client) inferred.push('CLIENT');
    if (user.link) inferred.push('LINK');
    if (user.hubId) inferred.push('HUB');

    if (inferred.length === 0) {
      console.log(`  - ${user.email}: sem relações para inferir, mantendo vazio`);
      continue;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { roles: inferred as any },
    });
    console.log(`  - ${user.email}: definido como [${inferred.join(', ')}]`);
  }

  console.log('Correção concluída. Faça logout e login novamente para renovar o token.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
