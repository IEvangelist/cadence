using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cadence.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCollaborationDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CollaborationDocuments",
                columns: table => new
                {
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    ProjectId = table.Column<string>(type: "text", nullable: false),
                    State = table.Column<byte[]>(type: "bytea", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CollaborationDocuments", x => new { x.OwnerId, x.ProjectId });
                    table.ForeignKey(
                        name: "FK_CollaborationDocuments_Projects_OwnerId_ProjectId",
                        columns: x => new { x.OwnerId, x.ProjectId },
                        principalTable: "Projects",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CollaborationDocuments");
        }
    }
}
