using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cadence.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCollaboration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ProjectShareLinks",
                columns: table => new
                {
                    Token = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    OwnerId = table.Column<string>(type: "text", nullable: false),
                    ProjectId = table.Column<string>(type: "text", nullable: false),
                    Role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProjectShareLinks", x => x.Token);
                    table.ForeignKey(
                        name: "FK_ProjectShareLinks_Projects_OwnerId_ProjectId",
                        columns: x => new { x.OwnerId, x.ProjectId },
                        principalTable: "Projects",
                        principalColumns: new[] { "OwnerId", "Id" },
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProjectShareLinks_OwnerId_ProjectId",
                table: "ProjectShareLinks",
                columns: new[] { "OwnerId", "ProjectId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ProjectShareLinks");
        }
    }
}
