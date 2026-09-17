-- CreateTable
CREATE TABLE "DrawingComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drawingId" TEXT NOT NULL,
    "parentId" TEXT,
    "authorUserId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "x" REAL NOT NULL DEFAULT 0,
    "y" REAL NOT NULL DEFAULT 0,
    "resolvedAt" DATETIME,
    "resolvedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DrawingComment_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DrawingComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DrawingComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DrawingComment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "DrawingComment_drawingId_createdAt_idx" ON "DrawingComment"("drawingId", "createdAt");

-- CreateIndex
CREATE INDEX "DrawingComment_parentId_idx" ON "DrawingComment"("parentId");
