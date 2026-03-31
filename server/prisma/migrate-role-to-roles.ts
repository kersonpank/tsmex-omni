/**
 * Migração: User.role → User.roles[]
 * Executar uma vez antes do deploy: npx ts-node prisma/migrate-role-to-roles.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Verifica se a coluna roles já existe
  const result = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'User' AND column_name IN ('role', 'roles')
  `;
  const hasRole = result.some(r => r.column_name === 'role');
  const hasRoles = result.some(r => r.column_name === 'roles');

  if (hasRoles && !hasRole) {
    console.log('Migração já aplicada (roles existe, role não).');
    return;
  }

  if (!hasRole) {
    console.log('Coluna role não encontrada. Nada a migrar.');
    return;
  }

  console.log('Migrando role → roles...');

  // Adiciona coluna roles se não existir
  if (!hasRoles) {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[]
    `);
    console.log('Coluna roles adicionada.');
  }

  // Copia role para roles onde roles está vazio
  await prisma.$executeRawUnsafe(`
    UPDATE "User" 
    SET "roles" = ARRAY["role"]::"UserRole"[] 
    WHERE "role" IS NOT NULL 
    AND (SELECT cardinality("roles")) = 0
  `);
  console.log('Dados copiados de role para roles.');

  // Para usuários que já têm roles mas role existe, garantir que role está em roles
  await prisma.$executeRawUnsafe(`
    UPDATE "User" 
    SET "roles" = array_remove(
      CASE WHEN "role" = ANY("roles") THEN "roles" ELSE array_append("roles", "role") END,
      NULL
    )::"UserRole"[]
    WHERE "role" IS NOT NULL
  `);

  // Remove coluna role
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" DROP COLUMN IF EXISTS "role"`);
  console.log('Coluna role removida.');

  console.log('Migração concluída.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
