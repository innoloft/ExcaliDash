-- CreateTable
CREATE TABLE "DrawingComment" (
    "id" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorUserId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "y" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrawingComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DrawingComment_drawingId_createdAt_idx" ON "DrawingComment"("drawingId", "createdAt");

-- CreateIndex
CREATE INDEX "DrawingComment_parentId_idx" ON "DrawingComment"("parentId");

-- AddForeignKey
ALTER TABLE "DrawingComment" ADD CONSTRAINT "DrawingComment_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingComment" ADD CONSTRAINT "DrawingComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DrawingComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingComment" ADD CONSTRAINT "DrawingComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
