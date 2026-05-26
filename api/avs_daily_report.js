const express = require("express");
const sequelize = require("../instance/db");
const cron = require('node-cron');
const moment = require('moment-timezone');

const router = express.Router();

//* ไม่ run 7:00 เพราะ data เข้า DB ไม่ทัน

cron.schedule('1 7 * * *', async () => {
    let dateToday;
    const hours = parseInt(moment().tz('Asia/Bangkok').format('HH'), 10);

    if (hours <= 7) {
        dateToday = moment().tz('Asia/Bangkok').subtract(1, "days").format("YYYY-MM-DD");
    } else {
        dateToday = moment().tz('Asia/Bangkok').format("YYYY-MM-DD");
    }

    await getDailyReport(dateToday);
    console.log("NAT - AVS - Running data reprod cron job for date:", dateToday, hours, moment().tz('Asia/Bangkok').format("YYYY-MM-DD HH:mm:ss"));
}, {
    timezone: "Asia/Bangkok"
});

const getDailyReport = async (dateQuery) => {
    let dateToday = dateQuery;
    let dateTomorrow = moment(dateToday).add(1, "days").format("YYYY-MM-DD");
    console.log("NAT - AVS - prod...", dateToday, dateTomorrow);

    try {
        let data = await sequelize.query(`
            DECLARE @Columns NVARCHAR(MAX);
            DECLARE @Database NVARCHAR(MAX);
            DECLARE @LineName NVARCHAR(MAX);
            DECLARE @SQL NVARCHAR(MAX);

            SET @Columns = '[total]';
            SET @Database = '[data_machine_avs].[dbo].[DATA_PRODUCTION_AVS]';
            SET @LineName = 'CAST(RIGHT(s.[mc_no],2) AS INT)';

            -- อย่าลืมแก้เวลาตัดกะ

            SET @SQL = '
                WITH [raw_data] AS (
                    SELECT
                        [registered],
                        CASE WHEN DATEPART(HOUR, registered) < 7 THEN CONVERT(date, DATEADD(DAY, -1, registered))
                            ELSE CONVERT(date, registered)
                        END AS [operation_day],
                        CASE WHEN DATEPART (HOUR, registered) BETWEEN 7 AND 18 THEN ''M'' ELSE ''N'' END AS [shift_mn],
                        [mc_no],
                        [process],
                        ' + @Columns + ' AS [prod_total],
                        CASE WHEN ' + @Columns + ' - LAG(' + @Columns + ') OVER (PARTITION BY mc_no ORDER BY registered) < 0 THEN ' + @Columns + '
                            ELSE ' + @Columns + ' - LAG(' + @Columns + ') OVER (PARTITION BY mc_no ORDER BY registered)
                        END AS [prod_total_diff]
                    FROM ' + @Database + '
                    WHERE [registered] BETWEEN ''${dateToday} 06:00'' AND ''${dateTomorrow} 07:00''
                ),
                [calc_shift] AS (
                    SELECT
                        MAX([operation_day]) AS [operation_day],
                        MAX([shift_mn]) AS [shift_mn],
                        [mc_no],
                        MAX([process]) AS [process],
                        SUM([prod_total_diff]) AS [prod_total_diff]
                    FROM [raw_data]
                    WHERE [operation_day] = ''${dateToday}''
                    GROUP BY 
                        [mc_no],
                        [shift_mn]
                ),
                [calc_daily] AS (
                    SELECT
                        [mc_no],
                        SUM([prod_total_diff]) AS [prod_daily]
                    FROM [calc_shift]
                    GROUP BY [mc_no]
                )
                SELECT
                    [operation_day],
                    ''true'' AS [is_operation_day],
                    UPPER(s.[process]) AS [process],
                    MAX(CONCAT(''LINE '', ' + @LineName + ')) AS [line_name],
                    UPPER(s.[mc_no]) AS [machine_name],

                    0 AS [daily_target_production_qty],
                    MAX([prod_daily]) AS [daily_actual_production_qty],

                    SUM(CASE WHEN [shift_mn] IN (''M'', ''A'') THEN [prod_total_diff]
                        ELSE 0
                    END) AS [shift1_actual_production_qty],
                    0 AS [shift1_target_production_qty],

                    SUM(CASE WHEN [shift_mn] IN (''N'', ''B'') THEN [prod_total_diff]
                        ELSE 0
                    END) AS [shift2_actual_production_qty],
                    0 AS [shift2_target_production_qty],

                    SUM(CASE WHEN [shift_mn] = ''C'' THEN [prod_total_diff]
                        ELSE 0
                    END) AS [shift3_actual_production_qty],
                    0 AS [shift3_target_production_qty]
                FROM [calc_shift] s
                LEFT JOIN [calc_daily] d ON s.[mc_no] = d.[mc_no]
                GROUP BY
                    [operation_day],
                    s.[process],
                    s.[mc_no]
                ORDER BY [machine_name]
            '
            EXEC sp_executesql @SQL;
        `);

        // STEP INSERT DATA
        if (data[0].length > 0) {
            const result = data[0]
            for (let i = 0; i < result.length; i++) {
                await sequelize.query(`
                    INSERT INTO  [NHT_DX_TO_PICO].[dbo].[AVS_DAILY_REPORT] (
                        [operation_day], [is_operation_day], [process], [line_name], [machine_name],
                        [daily_target_production_qty], [daily_actual_production_qty], [shift1_actual_production_qty],
                        [shift1_target_production_qty], [shift2_actual_production_qty], [shift2_target_production_qty],
                        [shift3_actual_production_qty], [shift3_target_production_qty], [registered_at]
                    )
                    SELECT
                        '${result[i].operation_day}', '${result[i].is_operation_day}', '${result[i].process}', '${result[i].line_name}', '${result[i].machine_name}',
                        ${result[i].daily_target_production_qty}, ${result[i].daily_actual_production_qty}, ${result[i].shift1_actual_production_qty},
                        ${result[i].shift1_target_production_qty}, ${result[i].shift2_actual_production_qty}, ${result[i].shift2_target_production_qty},
                        ${result[i].shift3_actual_production_qty}, ${result[i].shift3_target_production_qty}, GETDATE()
                    WHERE NOT EXISTS (
                        SELECT 1
                        FROM  [NHT_DX_TO_PICO].[dbo].[AVS_DAILY_REPORT]
                        WHERE
                            [operation_day] = '${result[i].operation_day}'
                            AND [line_name] = '${result[i].line_name}'
                            AND [machine_name] = '${result[i].machine_name}'
                            AND [daily_target_production_qty] = ${result[i].daily_target_production_qty}
                            AND [daily_actual_production_qty] = ${result[i].daily_actual_production_qty}
                    );
                `);
            }
            return {
                data: data[0],
                success: true,
                message: "Update data complete",
            }
        }
    } catch (error) {
        console.log("NAT - AVS - prod insert error:", error);
        return {
            data: error.message,
            success: true,
            message: "Can't update data",
        }
    }
}

module.exports = router;