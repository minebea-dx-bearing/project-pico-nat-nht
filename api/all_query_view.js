// Query for create view


// --------- For Create
// CREATE PROCEDURE sp_NHT_SETTING
// AS
// BEGIN
//     DECLARE @SQL NVARCHAR(MAX) = '';

//     SELECT @SQL = 'CREATE OR ALTER VIEW [v_NHT_SETTING] AS ' + 
//         STRING_AGG(CAST('SELECT * FROM [NHT_DX_TO_PICO].[dbo].[' + name + ']' AS NVARCHAR(MAX)), ' UNION ALL ')
//     FROM sys.tables 
//     WHERE name LIKE '%_SETTING';

//     EXEC sp_executesql @SQL;
// END

// --------- For Drop เมื่อมันซ้ำแล้วต้องการลบ
// // --DROP PROCEDURE sp_NHT_SETTING;

// --------- For Start view table :: เมื่อ run create แล้ว ให้มา run start ต่อค่ะ
// EXEC sp_NHT_SETTING;