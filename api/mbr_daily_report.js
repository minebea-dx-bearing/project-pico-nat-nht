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
    console.log("MBR - Running data reprod cron job for date:", dateToday, hours, moment().tz('Asia/Bangkok').format("YYYY-MM-DD HH:mm:ss"));
}, {
    timezone: "Asia/Bangkok"
});

const getDailyReport = async (dateQuery) => {
    dateToday = dateQuery;
    let dateTomorrow = moment(dateToday).add(1, "days").format("YYYY-MM-DD");
    console.log("MBR - prod...", dateToday, dateTomorrow);

    try {
        let data = await sequelize.query(
            `WITH[ordered_data] AS (
                SELECT
            [registered],
                    CASE WHEN DATEPART (HOUR, registered) BETWEEN 7 AND 18 THEN
                        'M'
                    ELSE
                        'N'
                    END AS[shift_mn],
            [mc_no],
            [process],
            [daily_tt]AS [prod_total],
                    LAG([daily_tt]) OVER (PARTITION BY[mc_no],
                        CASE WHEN DATEPART (HOUR, registered) BETWEEN 7 AND 18 THEN
                            'M'
                        ELSE
                            'N'
                        END ORDER BY[registered]) AS[prev_ok],
                    LEAD([daily_tt]) OVER (PARTITION BY[mc_no],
                        CASE WHEN DATEPART (HOUR, registered) BETWEEN 7 AND 18 THEN
                            'M'
                        ELSE
                            'N'
                        END ORDER BY[registered]) AS[next_ok]
                FROM
            [data_machine_assy1].[dbo].[DATA_PRODUCTION_ASSY]
                WHERE
            [registered] BETWEEN '${dateToday} 06:30' AND '${dateTomorrow} 07:30'
            ),
            [calculated] AS (
                SELECT
            [registered],
                    CASE WHEN DATEPART (HOUR,[registered]) < 7
                        OR[next_ok] IS NULL THEN
                        CONVERT(date, DATEADD (DAY, -1,[registered]))
                    ELSE
                        CONVERT(date,[registered])
                    END AS[operation_day],
            [shift_mn],
            [process],
            [mc_no],
            [prev_ok],
            [prod_total],
            [next_ok],
                    CASE WHEN[prev_ok] IS NULL
                        AND[prod_total] >[next_ok] THEN
                        0
                    WHEN[prev_ok] IS NULL THEN
                        -[prod_total]
                    WHEN[prod_total] >[next_ok] THEN
            [prod_total]
                    WHEN[next_ok] IS NULL THEN
            [prod_total]
                    ELSE
                        0
                    END AS[adjust_ok]
                FROM
            [ordered_data])
            SELECT
            [operation_day],
                'true' AS[is_operation_day],
                UPPER(m.[process]) AS[process],
                CONCAT('LINE ', line_no) AS line_name,
                UPPER(calculated.[mc_no]) AS[machine_name],
                0 AS[daily_target_production_qty],
                SUM([adjust_ok]) AS[daily_actual_production_qty],
                SUM(
                    CASE WHEN[shift_mn] IN ('M', 'A') THEN
            [adjust_ok]
                    ELSE
                        0
                    END) AS[shift1_actual_production_qty],
                0 AS[shift1_target_production_qty],
                SUM(
                    CASE WHEN[shift_mn] IN ('N', 'B') THEN
            [adjust_ok]
                    ELSE
                        0
                    END) AS[shift2_actual_production_qty],
                0 AS[shift2_target_production_qty],
                SUM(
                    CASE WHEN[shift_mn] = 'C' THEN
            [adjust_ok]
                    ELSE
                        0
                    END) AS[shift3_actual_production_qty],
                0 AS[shift3_target_production_qty]
            FROM
            [calculated]
                LEFT JOIN [data_machine_assy1].[dbo].[master_mc_run_parts] m ON calculated.mc_no = m.mc_no
            GROUP BY
            [operation_day],
                m.[process],
                calculated.[mc_no],
                line_no
            ORDER BY
                machine_name`
        );
        // console.log("MBR - data prod...", data[0]);

        // STEP INSERT DATA
        if (data[0].length > 0) {
            const result = data[0]
            for (let i = 0; i < result.length; i++) {
                await sequelize.query(
                    `
                INSERT INTO  [NHT_DX_TO_PICO].[dbo].[MBR_DAILY_REPORT] (
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
                    FROM  [NHT_DX_TO_PICO].[dbo].[MBR_DAILY_REPORT]
                    WHERE
                        [operation_day] = '${result[i].operation_day}'
                        AND [line_name] = '${result[i].line_name}'
                        AND [machine_name] = '${result[i].machine_name}'
                        AND [daily_target_production_qty] = ${result[i].daily_target_production_qty}
                        AND [daily_actual_production_qty] = ${result[i].daily_actual_production_qty}
);
`
                );

            }

            return {
                data: data[0],
                success: true,
                message: "Update data complete",
            }

        }

    } catch (error) {
        console.log("MBR - prod insert error:", error);
        return {
            data: error.message,
            success: true,
            message: "Can't update data",
        }

    }
}

module.exports = router;