-- CreateTable
CREATE TABLE "VisualIdentity" (
    "id" TEXT NOT NULL,
    "legalName" TEXT,
    "tradeName" TEXT,
    "cnpjDisplay" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressLine" TEXT,
    "footerNote" TEXT,
    "logoUrl" TEXT,
    "logoStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualIdentity_pkey" PRIMARY KEY ("id")
);
