-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
