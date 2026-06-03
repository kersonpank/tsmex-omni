-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'CLIENT', 'LINK', 'HUB');

-- CreateEnum
CREATE TYPE "PersonDocumentType" AS ENUM ('CPF', 'CNPJ');

-- CreateEnum
CREATE TYPE "LinkApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PricingTableType" AS ENUM ('SPECIAL', 'GENERAL');

-- CreateEnum
CREATE TYPE "FreightUnit" AS ENUM ('RS_KG', 'PERCENT', 'RS_M3', 'RS_UNIT');

-- CreateEnum
CREATE TYPE "MinFreightUnit" AS ENUM ('RS', 'KG');

-- CreateEnum
CREATE TYPE "TollUnit" AS ENUM ('RS_KG', 'FIXED');

-- CreateEnum
CREATE TYPE "DemandIntent" AS ENUM ('QUOTE_ONLY', 'COLLECT', 'DROP_AT_HUB');

-- CreateEnum
CREATE TYPE "DemandSource" AS ENUM ('CHAT', 'FORM', 'BATCH', 'API');

-- CreateEnum
CREATE TYPE "DemandStatus" AS ENUM ('PENDING', 'QUOTED', 'APPROVED', 'ASSIGNED', 'COLLECTED', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "RiskClass" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "ManifestStatus" AS ENUM ('DRAFT', 'PENDING_ACCEPT', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FeedbackAction" AS ENUM ('ACCEPTED', 'MODIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "OpportunityAccountRole" AS ENUM ('REMETENTE', 'DESTINATARIO', 'CONSIGNATARIO');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('QUOTE', 'FOLLOW_UP', 'COLLECTION_REQUESTED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "CompletenessLevel" AS ENUM ('MINIMAL', 'INCOMPLETE', 'COMPLETE');

-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('QUOTE_ONLY', 'TRANSPORT', 'COLLECTION', 'BOTH');

-- CreateEnum
CREATE TYPE "OpportunitySource" AS ENUM ('CHAT', 'WHATSAPP', 'PHONE', 'EMAIL', 'MANUAL', 'FORM', 'ENTRADA');

-- CreateEnum
CREATE TYPE "FreightTerm" AS ENUM ('CIF', 'FOB', 'REDESPACHO');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderEventType" AS ENUM ('CREATED', 'COLLECTED', 'IN_TRANSIT', 'AT_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'NOTE');

-- CreateEnum
CREATE TYPE "OrderInvoiceType" AS ENUM ('NFE', 'OUTRAS');

-- CreateEnum
CREATE TYPE "FreightDocType" AS ENUM ('CTE', 'MINUTA');

-- CreateEnum
CREATE TYPE "FreightCalcMethod" AS ENUM ('ESPECIAL', 'TARIFA_GERAL', 'INFORMADO');

-- CreateEnum
CREATE TYPE "FreightCalcStatus" AS ENUM ('DRAFT', 'CALCULATED', 'MINUTA_EMITTED', 'CTE_AUTHORIZED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "accountId" TEXT,
    "personId" TEXT,
    "hubId" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "documentType" "PersonDocumentType" NOT NULL,
    "document" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "cep" TEXT,
    "address" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'BRASIL',
    "stateRegistration" TEXT,
    "municipalRegistration" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT,
    "accountId" TEXT,
    "accountCompanyId" TEXT,
    "companyName" TEXT NOT NULL,
    "tradeName" TEXT,
    "document" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "defaultOrigin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxWeight" DOUBLE PRECISION NOT NULL,
    "maxVolume" DOUBLE PRECISION NOT NULL,
    "maxValue" DOUBLE PRECISION NOT NULL,
    "length" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "enclosed" BOOLEAN NOT NULL DEFAULT true,
    "refrigerated" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VehicleType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hub" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "personId" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "coverageCities" TEXT[],
    "coverageRadius" DOUBLE PRECISION,
    "storageCapacity" DOUBLE PRECISION,
    "dailyThroughput" DOUBLE PRECISION,
    "managerName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "rntrc" TEXT,
    "lastCteNumber" INTEGER NOT NULL DEFAULT 0,
    "lastMinutaNumber" INTEGER NOT NULL DEFAULT 0,
    "simplesNacional" BOOLEAN,
    "canOrchestrate" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HubOnboarding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "depositData" JSONB,
    "contactData" JSONB,
    "documents" JSONB,
    "bankData" JSONB,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HubOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Link" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personId" TEXT,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "vehicleTypeId" TEXT,
    "vehiclePlate" TEXT NOT NULL,
    "vehicleYear" INTEGER,
    "cnhNumber" TEXT,
    "cnhExpiry" TIMESTAMP(3),
    "crlvUrl" TEXT,
    "photoUrl" TEXT,
    "homeBase" TEXT NOT NULL,
    "coverageStates" TEXT[],
    "score" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "deliveryCount" INTEGER NOT NULL DEFAULT 0,
    "onTimeRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "approvalStatus" "LinkApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "whatsappPhone" TEXT,
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkOnboarding" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "documentsPersonal" JSONB,
    "documentsCavalo" JSONB,
    "documentsCarreta" JSONB,
    "contactsPersonal" JSONB,
    "contactsProfessional" JSONB,
    "vehiclePhotos" JSONB,
    "bankData" JSONB,
    "videoConfirmationUrl" TEXT,
    "hasTrailer" BOOLEAN NOT NULL DEFAULT false,
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRoute" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originCode" TEXT NOT NULL,
    "originName" TEXT NOT NULL,
    "destCode" TEXT NOT NULL,
    "destName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingTable" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "code" TEXT,
    "type" "PricingTableType" NOT NULL,
    "clientId" TEXT,
    "accountId" TEXT,
    "routeId" TEXT,
    "freightValue" DOUBLE PRECISION,
    "freightUnit" "FreightUnit" NOT NULL,
    "minFreightValue" DOUBLE PRECISION,
    "minFreightUnit" "MinFreightUnit",
    "adValoremPercent" DOUBLE PRECISION,
    "grisPercent" DOUBLE PRECISION,
    "tollValue" DOUBLE PRECISION,
    "tollUnit" "TollUnit",
    "dispatchFee" DOUBLE PRECISION,
    "otherFees" DOUBLE PRECISION,
    "cubeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cubeFactor" DOUBLE PRECISION,
    "icmsIncluded" BOOLEAN NOT NULL DEFAULT false,
    "icmsPercent" DOUBLE PRECISION,
    "adValoremThreshold" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinFreightRange" (
    "id" TEXT NOT NULL,
    "pricingTableId" TEXT NOT NULL,
    "minWeight" DOUBLE PRECISION NOT NULL,
    "maxWeight" DOUBLE PRECISION,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinFreightRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Demand" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "nfNumber" TEXT NOT NULL,
    "nfValue" DOUBLE PRECISION NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "commodity" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "cubedWeight" DOUBLE PRECISION,
    "units" INTEGER NOT NULL DEFAULT 1,
    "riskClass" "RiskClass" NOT NULL,
    "intentType" "DemandIntent" NOT NULL,
    "status" "DemandStatus" NOT NULL DEFAULT 'PENDING',
    "quotedPrice" DOUBLE PRECISION,
    "quotedAt" TIMESTAMP(3),
    "quotedTableId" TEXT,
    "manifestId" TEXT,
    "sourceType" "DemandSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Demand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandEvent" (
    "id" TEXT NOT NULL,
    "demandId" TEXT NOT NULL,
    "status" "DemandStatus" NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manifest" (
    "id" TEXT NOT NULL,
    "linkId" TEXT,
    "hubId" TEXT,
    "vehicleTypeId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "stops" JSONB,
    "totalWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "ManifestStatus" NOT NULL DEFAULT 'DRAFT',
    "offeredAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsolidationFeedback" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" "FeedbackAction" NOT NULL,
    "demandIds" TEXT[],
    "suggestedManifests" JSONB NOT NULL,
    "finalManifests" JSONB,
    "utilizationBefore" DOUBLE PRECISION,
    "utilizationAfter" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsolidationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "apiFormat" TEXT NOT NULL DEFAULT 'openai',
    "baseUrl" TEXT NOT NULL,
    "supportsTools" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LLMProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMModel" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "description" TEXT,
    "capabilities" TEXT[],
    "contextWindow" INTEGER NOT NULL DEFAULT 8192,
    "maxOutput" INTEGER NOT NULL DEFAULT 4096,
    "inputPrice" DOUBLE PRECISION,
    "outputPrice" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LLMModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatLLMConfig" (
    "id" TEXT NOT NULL,
    "selectionMode" TEXT NOT NULL DEFAULT 'FIXED',
    "fixedModelId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatLLMConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatLLMRotation" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatLLMRotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMApiKey" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "keyPreview" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "monthlyLimit" DOUBLE PRECISION,
    "monthlyUsage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LLMApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL DEFAULT 'COMPANY',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountCompany" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountContact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" "OpportunitySource" NOT NULL DEFAULT 'CHAT',
    "stage" "OpportunityStage" NOT NULL DEFAULT 'QUOTE',
    "completeness" "CompletenessLevel" NOT NULL DEFAULT 'INCOMPLETE',
    "type" "OpportunityType" NOT NULL DEFAULT 'QUOTE_ONLY',
    "cpfCnpjSender" TEXT,
    "cpfCnpjReceiver" TEXT,
    "cpfCnpjTransportadora" TEXT,
    "origin" TEXT,
    "destination" TEXT,
    "commodity" TEXT,
    "nfValue" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION,
    "volumes" INTEGER,
    "dimensions" TEXT,
    "needsCollection" BOOLEAN NOT NULL DEFAULT false,
    "collectionData" JSONB,
    "quotedPrice" DOUBLE PRECISION,
    "quoteBreakdown" JSONB,
    "validUntil" TIMESTAMP(3),
    "conversationSnapshot" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "lastFollowUp" TIMESTAMP(3),
    "nextFollowUp" TIMESTAMP(3),
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "matchedDemandId" TEXT,
    "accountRole" "OpportunityAccountRole",
    "freightTerm" "FreightTerm",
    "pipelineColumnId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "slug" TEXT NOT NULL,
    "historyJson" JSONB[] DEFAULT ARRAY[]::JSONB[],
    "identifiedAt" TIMESTAMP(3),
    "identifiedBy" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "State" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ibgeCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "State_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ibgeCode" TEXT NOT NULL,
    "cepStart" TEXT,
    "cepEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CEP" (
    "id" TEXT NOT NULL,
    "cep" TEXT NOT NULL,
    "logradouro" TEXT,
    "bairro" TEXT,
    "cityId" TEXT,
    "stateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CEP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "extractedData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "demandId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "manifestId" TEXT,
    "currentHubId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "nfNumber" TEXT,
    "nfDocumentUrl" TEXT,
    "freightTerm" "FreightTerm",
    "remetentePersonId" TEXT,
    "destinatarioPersonId" TEXT,
    "consignatarioPersonId" TEXT,
    "expedidorPersonId" TEXT,
    "redespachantePersonId" TEXT,
    "origemPrestacao" TEXT,
    "fimPrestacao" TEXT,
    "routeId" TEXT,
    "collectionData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enteredAtHubAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventType" "OrderEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "photoUrl" TEXT,
    "demandEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderInvoice" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderInvoiceType" NOT NULL,
    "nfNumber" TEXT NOT NULL,
    "nfKey" TEXT,
    "emissionDate" TIMESTAMP(3),
    "nature" TEXT,
    "species" TEXT,
    "volumes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cubedVolume" DOUBLE PRECISION,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFreightCalculation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "documentType" "FreightDocType" NOT NULL,
    "emissorId" TEXT NOT NULL,
    "calculationMethod" "FreightCalcMethod" NOT NULL,
    "pricingTableId" TEXT,
    "routeId" TEXT,
    "originCity" TEXT,
    "destCity" TEXT,
    "cfop" TEXT,
    "tipoFrete" TEXT,
    "cst" TEXT,
    "observacoes" TEXT,
    "volumes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cubedWeight" DOUBLE PRECISION,
    "cubage" DOUBLE PRECISION,
    "nfValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commodity" TEXT,
    "freightTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "icmsValue" DOUBLE PRECISION,
    "effectiveWeight" DOUBLE PRECISION,
    "minutaNumber" TEXT,
    "cteAccessKey" TEXT,
    "cteProtocol" TEXT,
    "status" "FreightCalcStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderFreightCalculation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NfSpecies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NfSpecies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "orderId" TEXT,
    "demandId" TEXT,
    "manifestId" TEXT,
    "accountId" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "taxes" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discounts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "pdfUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineColumn" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "stage" "OpportunityStage",
    "order" INTEGER NOT NULL DEFAULT 0,
    "filters" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineColumn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Admin_userId_key" ON "Admin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_document_key" ON "Person"("document");

-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_key" ON "Client"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_document_key" ON "Client"("document");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleType_code_key" ON "VehicleType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Hub_code_key" ON "Hub"("code");

-- CreateIndex
CREATE UNIQUE INDEX "HubOnboarding_userId_key" ON "HubOnboarding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Link_userId_key" ON "Link"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Link_document_key" ON "Link"("document");

-- CreateIndex
CREATE UNIQUE INDEX "LinkOnboarding_linkId_key" ON "LinkOnboarding"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "LLMProvider_code_key" ON "LLMProvider"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LLMModel_providerId_modelId_key" ON "LLMModel"("providerId", "modelId");

-- CreateIndex
CREATE INDEX "ChatLLMRotation_configId_idx" ON "ChatLLMRotation"("configId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatLLMRotation_configId_modelId_key" ON "ChatLLMRotation"("configId", "modelId");

-- CreateIndex
CREATE UNIQUE INDEX "LLMApiKey_providerId_key" ON "LLMApiKey"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCompany_cnpj_key" ON "AccountCompany"("cnpj");

-- CreateIndex
CREATE INDEX "AccountCompany_accountId_idx" ON "AccountCompany"("accountId");

-- CreateIndex
CREATE INDEX "AccountContact_accountId_idx" ON "AccountContact"("accountId");

-- CreateIndex
CREATE INDEX "Opportunity_accountId_stage_idx" ON "Opportunity"("accountId", "stage");

-- CreateIndex
CREATE INDEX "Opportunity_nextFollowUp_idx" ON "Opportunity"("nextFollowUp");

-- CreateIndex
CREATE INDEX "Opportunity_sessionId_idx" ON "Opportunity"("sessionId");

-- CreateIndex
CREATE INDEX "Opportunity_pipelineColumnId_idx" ON "Opportunity"("pipelineColumnId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_slug_key" ON "ChatSession"("slug");

-- CreateIndex
CREATE INDEX "ChatSession_slug_idx" ON "ChatSession"("slug");

-- CreateIndex
CREATE INDEX "ChatSession_accountId_idx" ON "ChatSession"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "State_code_key" ON "State"("code");

-- CreateIndex
CREATE UNIQUE INDEX "State_ibgeCode_key" ON "State"("ibgeCode");

-- CreateIndex
CREATE UNIQUE INDEX "City_ibgeCode_key" ON "City"("ibgeCode");

-- CreateIndex
CREATE INDEX "City_stateId_idx" ON "City"("stateId");

-- CreateIndex
CREATE INDEX "City_name_idx" ON "City"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CEP_cep_key" ON "CEP"("cep");

-- CreateIndex
CREATE INDEX "CEP_cep_idx" ON "CEP"("cep");

-- CreateIndex
CREATE INDEX "CEP_cityId_idx" ON "CEP"("cityId");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");

-- CreateIndex
CREATE INDEX "ChatAttachment_messageId_idx" ON "ChatAttachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_demandId_key" ON "Order"("demandId");

-- CreateIndex
CREATE INDEX "Order_demandId_idx" ON "Order"("demandId");

-- CreateIndex
CREATE INDEX "Order_opportunityId_idx" ON "Order"("opportunityId");

-- CreateIndex
CREATE INDEX "Order_manifestId_idx" ON "Order"("manifestId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_currentHubId_idx" ON "Order"("currentHubId");

-- CreateIndex
CREATE INDEX "OrderHistory_orderId_idx" ON "OrderHistory"("orderId");

-- CreateIndex
CREATE INDEX "OrderInvoice_orderId_idx" ON "OrderInvoice"("orderId");

-- CreateIndex
CREATE INDEX "OrderFreightCalculation_orderId_idx" ON "OrderFreightCalculation"("orderId");

-- CreateIndex
CREATE INDEX "OrderFreightCalculation_emissorId_idx" ON "OrderFreightCalculation"("emissorId");

-- CreateIndex
CREATE INDEX "OrderFreightCalculation_pricingTableId_idx" ON "OrderFreightCalculation"("pricingTableId");

-- CreateIndex
CREATE UNIQUE INDEX "NfSpecies_name_key" ON "NfSpecies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_accountId_idx" ON "Invoice"("accountId");

-- CreateIndex
CREATE INDEX "Invoice_orderId_idx" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "Invoice_demandId_idx" ON "Invoice"("demandId");

-- CreateIndex
CREATE INDEX "Invoice_manifestId_idx" ON "Invoice"("manifestId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "PipelineColumn_order_idx" ON "PipelineColumn"("order");

-- CreateIndex
CREATE INDEX "PipelineColumn_stage_idx" ON "PipelineColumn"("stage");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_accountCompanyId_fkey" FOREIGN KEY ("accountCompanyId") REFERENCES "AccountCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hub" ADD CONSTRAINT "Hub_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HubOnboarding" ADD CONSTRAINT "HubOnboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkOnboarding" ADD CONSTRAINT "LinkOnboarding_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTable" ADD CONSTRAINT "PricingTable_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTable" ADD CONSTRAINT "PricingTable_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTable" ADD CONSTRAINT "PricingTable_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "PricingRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MinFreightRange" ADD CONSTRAINT "MinFreightRange_pricingTableId_fkey" FOREIGN KEY ("pricingTableId") REFERENCES "PricingTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demand" ADD CONSTRAINT "Demand_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Demand" ADD CONSTRAINT "Demand_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandEvent" ADD CONSTRAINT "DemandEvent_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "Link"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_hubId_fkey" FOREIGN KEY ("hubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manifest" ADD CONSTRAINT "Manifest_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "VehicleType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsolidationFeedback" ADD CONSTRAINT "ConsolidationFeedback_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMModel" ADD CONSTRAINT "LLMModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LLMProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatLLMConfig" ADD CONSTRAINT "ChatLLMConfig_fixedModelId_fkey" FOREIGN KEY ("fixedModelId") REFERENCES "LLMModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatLLMRotation" ADD CONSTRAINT "ChatLLMRotation_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ChatLLMConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatLLMRotation" ADD CONSTRAINT "ChatLLMRotation_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "LLMModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LLMApiKey" ADD CONSTRAINT "LLMApiKey_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LLMProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCompany" ADD CONSTRAINT "AccountCompany_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountContact" ADD CONSTRAINT "AccountContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_pipelineColumnId_fkey" FOREIGN KEY ("pipelineColumnId") REFERENCES "PipelineColumn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CEP" ADD CONSTRAINT "CEP_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CEP" ADD CONSTRAINT "CEP_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_currentHubId_fkey" FOREIGN KEY ("currentHubId") REFERENCES "Hub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_remetentePersonId_fkey" FOREIGN KEY ("remetentePersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_destinatarioPersonId_fkey" FOREIGN KEY ("destinatarioPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_consignatarioPersonId_fkey" FOREIGN KEY ("consignatarioPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_expedidorPersonId_fkey" FOREIGN KEY ("expedidorPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_redespachantePersonId_fkey" FOREIGN KEY ("redespachantePersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "PricingRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderHistory" ADD CONSTRAINT "OrderHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderInvoice" ADD CONSTRAINT "OrderInvoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFreightCalculation" ADD CONSTRAINT "OrderFreightCalculation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFreightCalculation" ADD CONSTRAINT "OrderFreightCalculation_emissorId_fkey" FOREIGN KEY ("emissorId") REFERENCES "Hub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFreightCalculation" ADD CONSTRAINT "OrderFreightCalculation_pricingTableId_fkey" FOREIGN KEY ("pricingTableId") REFERENCES "PricingTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "Demand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "Manifest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;