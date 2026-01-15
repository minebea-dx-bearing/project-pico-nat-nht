// For New Notebook
const express = require("express");
const sequelize = require("../instance/db");
const cron = require('node-cron');
const moment = require('moment-timezone');
const dbNAT = require("../instance/db_nat");

const router = express.Router();

cron.schedule('1 7 * * *', async () => {
    let dateToday;
    const hours = parseInt(moment().tz('Asia/Bangkok').format('HH'), 10);

    if (hours <= 7) {
        dateToday = moment().tz('Asia/Bangkok').subtract(1, "days").format("YYYY-MM-DD");
    } else {
        dateToday = moment().tz('Asia/Bangkok').format("YYYY-MM-DD");
    }

    await NewStatusGetDailyStatusReport(dateToday); // For All M/C 
    console.log("NAT - GSSM - New Running data status cron job for date:", dateToday, hours, moment().tz('Asia/Bangkok').format("YYYY-MM-DD HH:mm:ss"));
}, {
    timezone: "Asia/Bangkok"
});

const NewStatusGetDailyStatusReport = async (dateQuery) => {
    let dateToday = dateQuery;
    let dateTomorrow = moment(dateToday).add(1, "days").format("YYYY-MM-DD");
    console.log("NAT - GSSM - Use date in NewStatusGetDailyStatusReport...", dateToday, dateTomorrow);
    try {
        let data = await dbNAT.query(
            `DECLARE @start_date DATETIME = '${dateToday} 07:00'; -- เปลี่ยนวันที่ด้วย
            DECLARE @TargetEndDate DATETIME = '${dateTomorrow} 07:00'; -- เปลี่ยนวันที่ด้วย
            DECLARE @end_date DATETIME = CASE
            WHEN @TargetEndDate > GETDATE()
            THEN GETDATE()
            ELSE @TargetEndDate
            END;
            DECLARE @start_date_p1 DATETIME = DATEADD(HOUR, -2, @start_date);    -- เวลาที่ต้องการลบไป 2hr เพื่อดึง alarm ตัวก่อนหน้า --
            DECLARE @end_date_p1 DATETIME = DATEADD(HOUR, 2, @end_date);        -- เวลาที่ต้องการบวกไป 2hr เพื่อดึง alarm ตัวหลัง --
                    
            WITH [base_alarm] AS (
                SELECT
                    [mc_no],
                    [occurred],
                    [alarm],
                    CASE
                        WHEN RIGHT([alarm], 1) = '_' THEN LEFT([alarm], LEN([alarm]) - 1)
                        ELSE [alarm]
                    END AS [status_alarm],
                    CASE
                        WHEN RIGHT([alarm], 1) = '_' THEN 'after'
                        ELSE 'before'
                    END AS [alarm_type]
                FROM [nat_mc_assy_gssm].[dbo].[DATA_ALARMLIS_GSSM]
                WHERE [occurred] BETWEEN @start_date_p1 AND @end_date_p1
            ),
            [with_pairing] AS (
                SELECT *,
                    LEAD([occurred]) OVER (PARTITION BY [mc_no], [status_alarm] ORDER BY [occurred]) AS [occurred_next],
                    LEAD([alarm_type]) OVER (PARTITION BY [mc_no], [status_alarm] ORDER BY [occurred]) AS [next_type]
                FROM [base_alarm]
            ),
            [paired_alarms] AS (
                SELECT
                    [mc_no],
                    [status_alarm],
                    [occurred] AS [occurred_start],
                    [occurred_next] AS [occurred_end]
                FROM [with_pairing]
                WHERE [alarm_type] = 'before' AND [next_type] = 'after'
            ),
            [base_monitor_iot] AS (
                SELECT
                    [mc_no],
                    [registered],
                    CAST(broker AS FLOAT) AS [broker_f]
                FROM [nat_mc_assy_gssm].[dbo].[MONITOR_IOT]
                WHERE registered BETWEEN @start_date_p1 AND @end_date_p1
            ),
            [mark] AS (
                SELECT
                    [mc_no],
                    [registered],
                    [broker_f],
                    CASE WHEN [broker_f] = 0 THEN 1 ELSE 0 END AS [is_zero],
                    LAG(CASE WHEN [broker_f] = 0 THEN 1 ELSE 0 END)
                        OVER (PARTITION BY [mc_no] ORDER BY [registered]) AS [prev_is_zero],
                    LEAD(CASE WHEN [broker_f] = 0 THEN 1 ELSE 0 END)
                        OVER (PARTITION BY [mc_no] ORDER BY [registered]) AS [next_is_zero],
                    LEAD([registered])
                        OVER (PARTITION BY [mc_no] ORDER BY [registered]) AS [next_registered]
                FROM [base_monitor_iot]
            ),
            [flagged] AS (
                SELECT
                    *,
                    CASE WHEN [is_zero] = 1 AND ISNULL([prev_is_zero],0) = 0 THEN 1 ELSE 0 END AS [start_flag],
                    CASE WHEN [is_zero] = 1 AND ISNULL([next_is_zero],0) = 0 THEN 1 ELSE 0 END AS [end_flag]
                FROM [mark]
            ),
            [grpz] AS (
                SELECT
                    *,
                    SUM(CASE WHEN [start_flag] = 1 THEN 1 ELSE 0 END)
                        OVER (PARTITION BY [mc_no] ORDER BY [registered] ROWS UNBOUNDED PRECEDING) AS [grp]
                FROM [flagged]
                WHERE [is_zero] = 1
            ),
            [summary_connection_lose] AS (
                SELECT
                [mc_no],
                'connection lose' AS [status_alarm],
                MIN(registered) AS [occurred_start],
                MAX(CASE WHEN [end_flag] = 1 THEN ISNULL([next_registered], [registered]) END) AS [occurred_end]
                FROM [grpz]
                GROUP BY [mc_no], [grp]
            ),
            [conbine_connection_lose] AS (
                SELECT * FROM [summary_connection_lose]
                UNION ALL
                SELECT * FROM [paired_alarms]
            ),
            [with_max_prev] AS (
                SELECT *,
                    MAX([occurred_end]) OVER (
                        PARTITION BY [mc_no]
                        ORDER BY [occurred_start]
                        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                    ) AS [max_prev_end]
                FROM [conbine_connection_lose]
            ),
            [check_duplicate] AS (
                SELECT
                    [mc_no],
                    [status_alarm],
                    [occurred_start],
                    [occurred_end],
                    CASE
                        WHEN [max_prev_end] IS NOT NULL AND [occurred_end] <= [max_prev_end] THEN 1
                        ELSE 0
                    END AS [duplicate]
                FROM [with_max_prev]
            ),
            [clamped_alarms] AS (
                SELECT
                    [mc_no],
                    [status_alarm],
                    [occurred_start],
                    [occurred_end],
                    LAG([status_alarm]) OVER (PARTITION BY [mc_no] ORDER BY [occurred_end]) AS [previous_alarm],
                    LAG([occurred_end]) OVER (PARTITION BY [mc_no] ORDER BY [occurred_end]) AS [previous_occurred],
                    DATEDIFF(SECOND, LAG([occurred_end]) OVER (PARTITION BY [mc_no] ORDER BY [occurred_end]), [occurred_start]) AS [previous_gap_seconds],
                    LEAD([status_alarm]) OVER (PARTITION BY [mc_no] ORDER BY [occurred_start]) AS [next_alarm],
                    LEAD([occurred_start]) OVER (PARTITION BY [mc_no] ORDER BY [occurred_start]) AS [next_occurred],
                    DATEDIFF(SECOND, [occurred_end], LEAD([occurred_start]) OVER (PARTITION BY [mc_no] ORDER BY [occurred_start])) AS [next_gap_seconds]
                FROM [check_duplicate]
                WHERE [duplicate] = 0
            ),
            [edit_occurred] AS (
                SELECT
                    *,
                    CASE
                        WHEN [previous_gap_seconds] < 0 AND [previous_alarm] = 'mc_run' THEN [previous_occurred]
                        WHEN [previous_gap_seconds] < 0 THEN [previous_occurred]
                        ELSE [occurred_start]
                    END AS [new_occurred_start]
                FROM [clamped_alarms]
            ),
            [insert_stop] AS (
                SELECT
                    [mc_no],
                    'STOP' AS [status_alarm],
                    [occurred_end] AS [occurred_start],
                    [next_occurred] AS [occurred_end]
                FROM [edit_occurred]
                WHERE [next_gap_seconds] > 0
            ),
            [insert_stop_end] AS (
                SELECT
                    [mc_no],
                    'STOP' AS [status_alarm],
                    [occurred_end] AS [occurred_start],
                    @end_date AS [occurred_end]
                FROM [edit_occurred]
                WHERE [next_gap_seconds] IS NULL
            ),
            [insert_stop_start] AS (
                SELECT
                    [mc_no],
                    'STOP' AS [status_alarm],
                    @start_date AS [occurred_start],
                    [new_occurred_start] AS [occurred_end]
                FROM [edit_occurred]
                WHERE [previous_gap_seconds] IS NULL
            ),
            [combine_result] AS (
                SELECT UPPER([mc_no]) AS [mc_no], UPPER([status_alarm]) AS [status_alarm], [new_occurred_start] AS [occurred_start], [occurred_end] FROM [edit_occurred]
                UNION ALL
                SELECT UPPER([mc_no]) AS [mc_no], [status_alarm], [occurred_start], [occurred_end] FROM [insert_stop]
                UNION ALL
                SELECT UPPER([mc_no]) AS [mc_no], [status_alarm], [occurred_start], [occurred_end] FROM [insert_stop_end]
                UNION ALL
                SELECT UPPER([mc_no]) AS [mc_no], [status_alarm], [occurred_start], [occurred_end] FROM [insert_stop_start]
            ),
            [edit_time_result] AS (
                SELECT
                    [mc_no],
                    [status_alarm],
                    CASE 
                        WHEN [occurred_start] < @start_date THEN CAST(@start_date AS datetime)
                        ELSE [occurred_start]
                    END AS [occurred_start],
                    CASE 
                        WHEN [occurred_end] > @end_date THEN CAST(@end_date AS datetime)
                        ELSE [occurred_end]
                    END AS [occurred_end]
                FROM [combine_result]
            ),
            [filter_result] AS (
                SELECT
                    *,
                    'GSSM' AS [process] -- add process เอง
                FROM [edit_time_result]
                WHERE
                    [occurred_end] > [occurred_start]
            ),
            [summary_alarm] AS (
                SELECT
                    f.mc_no,
                    f.process,
                    status_alarm,
                    occurred_start,
                    occurred_end,
                CASE 
                    WHEN DATEPART(HOUR, [occurred_start]) < 7 THEN 
                        CONVERT(date, DATEADD(DAY, -1, [occurred_start]))
                    ELSE 
                        CONVERT(date, [occurred_start])
                END AS [date],
                CASE 
                    WHEN CONVERT(TIME, [occurred_start]) BETWEEN '07:00:00' AND '18:59:59' THEN 'M'
                    ELSE 'N'
                END AS [shift_mn],
                DATEDIFF(SECOND, [occurred_start], [occurred_end]) AS [duration_seconds]
                FROM [filter_result] f
            )
                    
            -- Pattern data PICO --
            SELECT
                [date] AS [operation_day]
                ,'true' AS [is_operation_day]
                ,UPPER([process]) AS [process]
                ,CONCAT('LINE ', CAST(RIGHT([mc_no], 2) AS INT))  AS line_name
                ,UPPER([mc_no]) AS [machine_name]
                ,[status_alarm] AS [status_name]
                ,SUM([duration_seconds]) AS [daily_duration_s]
                ,COUNT([status_alarm]) AS [daily_count]
                ,SUM(CASE WHEN [shift_mn] = 'M' OR [shift_mn] = 'A' THEN [duration_seconds] ELSE 0 END) AS [shift1_duration_s]
                ,SUM(CASE WHEN [shift_mn] = 'M' OR [shift_mn] = 'A' THEN 1 ELSE 0 END) AS [shift1_count]
                ,SUM(CASE WHEN [shift_mn] = 'N' OR [shift_mn] = 'B' THEN [duration_seconds] ELSE 0 END) AS [shift2_duration_s]
                ,SUM(CASE WHEN [shift_mn] = 'N' OR [shift_mn] = 'B' THEN 1 ELSE 0 END) AS [shift2_count]
                ,SUM(CASE WHEN [shift_mn] = 'C' THEN [duration_seconds] ELSE 0 END) AS [shift3_duration_s]
                ,SUM(CASE WHEN [shift_mn] = 'C' THEN 1 ELSE 0 END) AS [shift3_count]
            FROM [summary_alarm]
            GROUP BY
                [mc_no]
                ,[process]
                ,[date]
                ,[status_alarm]
            ORDER BY [operation_day], [machine_name], [status_name]`
        );
        // console.log(data);
        
        // STEP INSERT DATA
        if (data[0].length > 0) {
            const result = data[0]
            for (let index = 0; index < result.length; index++) {
                await sequelize.query(
                    `
            INSERT INTO [NAT_DX_TO_PICO].[dbo].[GSSM_DAILY_STATUS_REPORT] ([operation_day],[is_operation_day],[process],[line_name],[machine_name],[status_name],[daily_duration_s],[daily_count],[shift1_duration_s],[shift1_count],[shift2_duration_s],[shift2_count],[shift3_duration_s],[shift3_count],[registered_at])
            SELECT
                '${result[index].operation_day}',
                '${result[index].is_operation_day}',
                '${result[index].process}',
                '${result[index].line_name}',
                '${result[index].machine_name}',
                '${result[index].status_name}',
                ${result[index].daily_duration_s},
                ${result[index].daily_count},
                ${result[index].shift1_duration_s},
                ${result[index].shift1_count},
                ${result[index].shift2_duration_s},
                ${result[index].shift2_count},
                ${result[index].shift3_duration_s},
                ${result[index].shift3_count},
                GETDATE ()
            WHERE
                NOT EXISTS (
                    SELECT
                        1
                    FROM
            [NAT_DX_TO_PICO].[dbo].[GSSM_DAILY_STATUS_REPORT]
                    WHERE
            [operation_day] = '${result[index].operation_day}'
                        AND [line_name] = '${result[index].line_name}'
                        AND [machine_name] = '${result[index].machine_name}'
                        AND [status_name] = '${result[index].status_name}'
                        AND [daily_duration_s] = ${result[index].daily_duration_s}
                        AND [daily_count] = ${result[index].daily_count});
`
                );
            }
            console.log("NAT - GSSM - Insert status new Done!");

            return {
                data: data[0],
                success: true,
                message: "Update data complete",
            }
        } else {
            console.log("NAT - GSSM - Can't new insert : Length = 0");

        }

    } catch (error) {
        console.log("NAT - GSSM - new status insert error:", error);
        return {
            data: error.message,
            success: true,
            message: "Can't update data",
        }

    }
}


const getDaily = async (dateToday) => {
    const date = new Date(dateToday);
    const year = date.getFullYear();
    const month = date.getMonth(); // เดือนเริ่มจาก 0 (มกราคม = 0)

    // หาวันสุดท้ายของเดือนนี้
    const lastDay = new Date(year, month + 1, 0).getDate();

    // วนลูปทุกวันในเดือนนี้
    for (let day = 0; day <= lastDay; day++) {
        // สร้างวันที่ในรูปแบบ 'YYYY-MM-DD'
        const currentDate = new Date(year, month, day);
        const formatted = currentDate.toISOString().split('T')[0];
        console.log(formatted);
        await NewStatusGetDailyStatusReport(formatted);
        console.log("ok");
    }
}
 
// เรียกใช้
// getDaily('2025-09-01'); 
// NewStatusGetDailyStatusReport('2025-12-26');

module.exports = router;