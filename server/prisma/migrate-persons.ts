/**
 * Script de migração: cria Person para cada Client e Link existentes
 * e associa personId. Execute: npm run db:migrate-persons (ou tsx prisma/migrate-persons.ts)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function normalizeDocument(doc: string): string {
  return doc.replace(/\D/g, '');
}

function inferDocumentType(doc: string): 'CPF' | 'CNPJ' {
  const digits = normalizeDocument(doc);
  return digits.length === 11 ? 'CPF' : 'CNPJ';
}

async function main() {
  console.log('🔄 Migrando Client e Link para Person...\n');

  // 1. Para cada Client: criar ou reutilizar Person (CNPJ) e setar client.personId
  const clients = await prisma.client.findMany({
    include: { accountCompany: true },
  });

  for (const client of clients) {
    const document = normalizeDocument(client.document);
    if (!document) continue;

    let person = await prisma.person.findUnique({
      where: { document },
    });

    if (!person) {
      person = await prisma.person.create({
        data: {
          documentType: 'CNPJ',
          document,
          legalName: client.companyName,
          tradeName: client.tradeName ?? undefined,
          address: client.accountCompany?.address ?? undefined,
          city: client.accountCompany?.city ?? undefined,
          state: client.accountCompany?.state ?? undefined,
          country: 'BRASIL',
        },
      });
      console.log(`  Person criada (CNPJ): ${person.legalName} - ${document}`);
    }

    await prisma.client.update({
      where: { id: client.id },
      data: { personId: person.id },
    });
  }

  console.log(`\n✅ ${clients.length} Client(s) vinculado(s) a Person.\n`);

  // 2. Para cada Link: criar ou reutilizar Person (CPF/CNPJ) e setar link.personId
  const links = await prisma.link.findMany();

  for (const link of links) {
    const document = normalizeDocument(link.document);
    if (!document) continue;

    let person = await prisma.person.findUnique({
      where: { document },
    });

    if (!person) {
      const documentType = inferDocumentType(link.document);
      person = await prisma.person.create({
        data: {
          documentType,
          document,
          legalName: link.name,
          country: 'BRASIL',
        },
      });
      console.log(`  Person criada (${documentType}): ${person.legalName} - ${document}`);
    }

    await prisma.link.update({
      where: { id: link.id },
      data: { personId: person.id },
    });
  }

  console.log(`\n✅ ${links.length} Link(s) vinculado(s) a Person.`);
  console.log('\n✅ Migração concluída.\n');
}

main()
  .catch((e) => {
    console.error('Erro na migração:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
