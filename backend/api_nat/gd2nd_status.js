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
    console.log("NAT - GD2ND - New Running data status cron job for date:", dateToday, hours, moment().tz('Asia/Bangkok').format("YYYY-MM-DD HH:mm:ss"));
}, {
    timezone: "Asia/Bangkok"
});

const NewStatusGetDailyStatusReport = async (dateQuery) => {
    let dateToday = dateQuery;
    let dateTomorrow = moment(dateToday).add(1, "days").format("YYYY-MM-DD");
    console.log("NAT - GD2ND - Use date in NewStatusGetDailyStatusReport...", dateToday, dateTomorrow);
    try {
        let dataOR = await dbNAT.query(`
            DECLARE @start_date DATETIME = '${dateToday} 07:00'; -- เปลี่ยนวันที่ด้วย
            DECLARE @TargetEndDate DATETIME = '${dateTomorrow} 07:00'; -- เปลี่ยนวันที่ด้วย
            DECLARE @end_date DATETIME = CASE WHEN @TargetEndDate > GETDATE()
                                            THEN GETDATE()
                                            ELSE @TargetEndDate
                                        END;
            DECLARE @start_date_p1 DATETIME = DATEADD(HOUR, -2, @start_date);    -- เวลาที่ต้องการลบไป 2hr เพื่อดึง alarm ตัวก่อนหน้า --
            DECLARE @end_date_p1 DATETIME = DATEADD(HOUR, 2, @end_date);        -- เวลาที่ต้องการบวกไป 2hr เพื่อดึง alarm ตัวหลัง --
            DECLARE @shiftStart NVARCHAR(50) = '07:00:00';
            DECLARE @shiftStop NVARCHAR(50) = '18:59:59';
                    
            WITH [base_alarm] AS (
                SELECT
                    [mc_no],
                    [occurred],
                    [alarm],
					[process],
                    CASE
                        WHEN RIGHT([alarm], 1) = '_' THEN LEFT([alarm], LEN([alarm]) - 1)
                        ELSE [alarm]
                    END AS [status_alarm],
                    CASE
                        WHEN RIGHT([alarm], 1) = '_' THEN 'after'
                        ELSE 'before'
                    END AS [alarm_type]
                FROM [nat_mc_mcshop_2gd].[dbo].[DATA_ALARMLIS_2GD]
                WHERE [occurred] BETWEEN @start_date_p1 AND @end_date_p1 AND mc_no like 'OR%'
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
					[process],
                    [status_alarm],
                    [occurred] AS [occurred_start],
                    [occurred_next] AS [occurred_end]
                FROM [with_pairing]
                WHERE [alarm_type] = 'before' AND [next_type] = 'after'
            ),
            [base_monitor_iot] AS (
                SELECT
                    [mc_no],
					[process],
                    [registered],
                    CAST(broker AS FLOAT) AS [broker_f]
                FROM [nat_mc_mcshop_2gd].[dbo].[MONITOR_IOT]
                WHERE registered BETWEEN @start_date_p1 AND @end_date_p1 AND mc_no like 'OR%'
            ),
            [mark] AS (
                SELECT
                    [mc_no],
					[process],
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
					MAX([process]) AS [process],
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
					[process],
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
					[process],
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
					[process],
                    'STOP' AS [status_alarm],
                    [occurred_end] AS [occurred_start],
                    [next_occurred] AS [occurred_end]
                FROM [edit_occurred]
                WHERE [next_gap_seconds] > 0
            ),
            [insert_stop_end] AS (
                SELECT
                    [mc_no],
					[process],
                    'STOP' AS [status_alarm],
                    [occurred_end] AS [occurred_start],
                    @end_date AS [occurred_end]
                FROM [edit_occurred]
                WHERE [next_gap_seconds] IS NULL
            ),
            [insert_stop_start] AS (
                SELECT
                    [mc_no],
					[process],
                    'STOP' AS [status_alarm],
                    @start_date AS [occurred_start],
                    [new_occurred_start] AS [occurred_end]
                FROM [edit_occurred]
                WHERE [previous_gap_seconds] IS NULL
            ),
            [combine_result] AS (
                SELECT UPPER([mc_no]) AS [mc_no], [process], UPPER([status_alarm]) AS [status_alarm], [new_occurred_start] AS [occurred_start], [occurred_end] FROM [edit_occurred]
                UNION ALL
                SELECT UPPER([mc_no]) AS [mc_no], [process], [status_alarm], [occurred_start], [occurred_end] FROM [insert_stop]
                UNION ALL
                SELECT UPPER([mc_no]) AS [mc_no], [process], [status_alarm], [occurred_start], [occurred_end] FROM [insert_stop_end]
                UNION ALL
                SELECT UPPER([mc_no]) AS [mc_no], [process], [status_alarm], [occurred_start], [occurred_end] FROM [insert_stop_start]
            ),
            [edit_time_result] AS (
                SELECT
                    [mc_no],
					[process],
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
                    *
                FROM [edit_time_result]
                WHERE [occurred_end] > [occurred_start]
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
                    WHEN CONVERT(TIME, [occurred_start]) BETWEEN @shiftStart AND @shiftStop THEN 'M'
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
                ,CONCAT('LINE ', CAST(LEFT(RIGHT([mc_no],3),2) AS INT))  AS line_name
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
            ORDER BY [operation_day], [machine_name], [status_name]
        `);

        let dataIR = await dbNAT.query(`
            DECLARE @start_date DATETIME = '${dateToday} 07:00:00';
            DECLARE @end_date DATETIME = '${dateTomorrow} 07:00:00';

            -- ดึง status ก่อน-หลัง 1hr
            DECLARE @start_date_before DATETIME = DATEADD(HOUR, -1, @start_date);

            DECLARE @end_min_check_status DATETIME = DATEADD(MINUTE, 1, @start_date); -- เอาไว้เช็ค monitor iot ตอน 7 โมงเพราะมันไม่ได้ insert 07:00:00:000 เป๊ะ

            DECLARE @shift1 NVARCHAR(50) = '07:00:00';
            DECLARE @shift2 NVARCHAR(50) = '19:00:00'; -- เขียนแบบนี้เพราะใช้ between check

            WITH [status] AS (
                SELECT 
                    [mc_no],
                    [process],
                    [occurred],
                    CASE WHEN DATEPART(HOUR, [occurred]) < 7 THEN CONVERT(date, DATEADD(DAY, -1, [occurred]))
                        ELSE CONVERT(date, [occurred])
                    END AS [work_date],
                    [mc_status],
                    [occurred] AS [occurred_start]
                FROM [nat_mc_mcshop_2gd].[dbo].[DATA_MCSTATUS_2GD]
                WHERE registered BETWEEN @start_date and @end_date AND mc_no like 'IR%'
            ),
            [all_mc] AS (
                SELECT DISTINCT [mc_no]
                FROM [nat_mc_mcshop_2gd].[dbo].[DATA_MASTER_2GD]
            ),
            [monitor_iot] AS (
                SELECT
                    [mc_no],
                    [process],
                    CASE WHEN DATEPART(HOUR, [registered]) < 7 THEN CONVERT(date, DATEADD(DAY, -1, [registered]))
                        ELSE CONVERT(date, [registered])
                    END AS [work_date],
                    [registered],
                    CAST([broker] AS FLOAT) AS [broker],
                    LAG(CAST([broker] AS FLOAT)) OVER (PARTITION BY [mc_no] ORDER BY [registered]) AS [broker_prv]
                FROM [nat_mc_mcshop_2gd].[dbo].[MONITOR_IOT]
                WHERE registered BETWEEN @start_date_before and @end_date AND mc_no like 'IR%'
            ),
            [first_status] AS (
                -- เอา status สุดท้ายก่อนที่จะถึง @start_date มา
                SELECT 
                    [mc_no],
                    [process],
                    CONVERT(date, [occurred]) AS [work_date],
                    [mc_status],
                    CAST(CAST(@start_date AS DATE) AS DATETIME) AS [occurred_start],
                    ROW_NUMBER() OVER (PARTITION BY [mc_no] ORDER BY occurred desc) as rn
                FROM [nat_mc_mcshop_2gd].[dbo].[DATA_MCSTATUS_2GD]
                where [occurred] < @start_date and [occurred] >= DATEADD(DAY, -1, @start_date) AND mc_no like 'IR%'
            ),
            [merge_status] AS (
                -- เพิ่ม connection loss เข้ามาโดยเช็ค broker จาก monitor_iot
                SELECT 
                    [mc_no],
                    [process],
                    [work_date],
                    [mc_status],
                    [occurred_start]
                FROM [status]
                UNION ALL
                SELECT 
                    [mc_no],
                    [process],
                    [work_date],
                    'connection lost' AS [mc_status],
                    [registered] AS [occurred_start]
                FROM [monitor_iot]
                WHERE ([broker_prv] = 1 AND [broker] = 0 AND [registered] BETWEEN @start_date AND @end_date) 
                OR ([registered] BETWEEN @start_date AND @end_min_check_status AND [broker_prv] = 0 AND [broker] = 0)
                -- ถ้า broker = 0 ก่อน 7 โมงก็ให้เพิ่ม connection loss ด้วย
                UNION ALL
                -- เพิ่ม connection lost สำหรับเครื่องที่ไม่มี status ส่งมาเลย
                SELECT 
                    a.[mc_no],
                    '2gd' AS [process],
                    CAST(@start_date AS DATE) AS [work_date],
                    'connection lost' AS [mc_status],
                    @start_date AS [occurred_start]
                FROM [all_mc] a
                WHERE NOT EXISTS(SELECT 1 FROM [status] s WHERE s.[mc_no] = a.[mc_no])
                UNION ALL
                -- เมื่อกล่องเปลี่ยนจาก 0 เป็น 1 แต่ไม่มี status ส่งมาในรอบ +- 5 นาที ให้ดึง status ล่าสุดก่อนหน้านั้นมาใส่
                SELECT 
                    m.[mc_no],
                    m.[process],
                    m.[work_date], 
                    CASE WHEN NOT EXISTS (
                            SELECT 1 FROM [nat_mc_mcshop_2gd].[dbo].[DATA_MCSTATUS_2GD] s
                            WHERE s.[mc_no] = m.[mc_no]
                            AND (s.[occurred] > m.[registered] OR s.[occurred] BETWEEN DATEADD(MINUTE, -5, m.[registered]) AND DATEADD(MINUTE, 5, m.[registered]))
                            AND s.[occurred] <= @end_date AND mc_no like 'IR%'
                        ) THEN 'connection lost' --ถ้าหลังจาก broker กลับมาเป็น 1 แต่ไม่มี status ส่งมาเลย ให้เป็น connection lost
                        ELSE ISNULL(last_s.[mc_status], 'connection lost')
                    END AS [mc_status],
                    m.[registered] AS [occurred_start]
                FROM [monitor_iot] m
                OUTER APPLY (
                    SELECT TOP 1 
                        s.[mc_status],
                        MAX(CASE WHEN s.[occurred] BETWEEN DATEADD(MINUTE, -5, m.[registered]) AND DATEADD(MINUTE, 5, m.[registered]) THEN 1 ELSE 0 END) OVER() as has_current_status
                    FROM [nat_mc_mcshop_2gd].[dbo].[DATA_MCSTATUS_2GD] s
                    WHERE s.[mc_no] = m.[mc_no]
                    AND s.[occurred] <= DATEADD(MINUTE, 5, m.[registered])
                    AND s.[occurred] >= DATEADD(DAY, -1, m.[registered])  --ดึงข้อมูลเก่าล่าสุดมาโดยไม่เกิน 1 วันก่อนหน้า 
                    ORDER BY s.[occurred] DESC
                ) last_s
                WHERE m.[broker_prv] = 0 AND m.[broker] = 1
                AND m.[registered] BETWEEN @start_date AND @end_date
                AND (last_s.has_current_status IS NULL OR last_s.has_current_status = 0)
                AND mc_no like 'IR%'
            ),
            [first_merge_status] AS (
                -- เอาตัวแรกของ status จาก [merge_status]
                SELECT 
                    [mc_no],
                    [process],
                    [work_date],
                    [mc_status],
                    [occurred_start],
                    ROW_NUMBER() OVER (PARTITION BY [mc_no] ORDER BY [occurred_start]) as rn
                FROM [merge_status]
            ),
            [merge_all] AS (
                -- เอา [first_status] มาใส่เมื่อตั้วแรกที่ดึงจาก [first_merge_status] ไม่ใช่ connection lost และต้องเช็คให้เป็น m/c เครื่องเดียวกัน
                SELECT * FROM [merge_status]
                UNION ALL
                SELECT 
                    [mc_no],
                    [process],
                    [work_date],
                    [mc_status],
                    [occurred_start]
                FROM [first_status] s
                WHERE s.rn = 1 
                AND EXISTS (
                    SELECT 1 FROM [first_merge_status] m
                    WHERE m.[mc_no] = s.[mc_no] 
                    AND m.rn = 1 
                    AND NOT (
                        m.[mc_status] = 'connection lost' 
                        AND m.[occurred_start] BETWEEN @start_date AND @end_min_check_status)
                )
                --order by mc_no, occurred_start
            ),
            [set_occurred] AS (
                -- เอา [occurred_start] ของ status ต่อไปมาเป็น [occurred_end] ของ status ปัจุบัน
                SELECT 
                    *,
                    LEAD([occurred_start]) OVER (PARTITION BY [mc_no] ORDER BY [occurred_start]) AS [occurred_end]
                FROM [merge_all]
            ),
            [set_time] AS (
                -- set เวลา status แรกให้เป็นตาม @start_date และ status สุดท้ายให้เป็นตาม @end_date
                SELECT
                    [mc_no],
                    [process],
                    CAST(@start_date AS DATE) AS [work_date],
                    [mc_status],
                    CASE 
                        WHEN ([occurred_start] < @start_date)
                            OR [mc_status] = 'connection lost' AND [occurred_start] BETWEEN @start_date AND @end_min_check_status
                        THEN @start_date
                        ELSE [occurred_start]
                    END AS [occurred_start],
                    CASE 
                        WHEN ([occurred_end] IS NULL AND [occurred_start] BETWEEN @start_date AND @end_min_check_status)
                            OR ([occurred_end] IS NULL)
                        THEN @end_date
                        ELSE [occurred_end]
                    END AS [occurred_end]
                FROM [set_occurred]
                WHERE ([occurred_end] > @start_date AND [occurred_start] < @end_date) OR [mc_status] = 'connection lost' OR [occurred_end] IS NULL
            ),
            [shift] AS (
                SELECT
                    *,
                    CASE WHEN CONVERT(TIME, [occurred_start]) BETWEEN @shift1 AND @shift2 THEN 'M'
                        ELSE 'N'
                    END AS [shift],
                    DATEADD(HOUR, 19, CAST(CAST([occurred_start] AS DATE) AS DATETIME)) AS [split_shift]
                FROM [set_time]
            ),
            [split_shift] AS (
                -- แยก status ที่เกิดคร่อมเวลากะ(1 ทุ่ม) ออกเป็น 2 อันให้จบที่ 19:00 และเริ่มที่ 19:00
                SELECT 
                    s.[mc_no], 
                    s.[process], 
                    s.[work_date], 
                    s.[mc_status],
                    v.[occurred_start], 
                    v.[occurred_end], 
                    v.[shift]
                FROM [shift] s
                CROSS APPLY (
                    -- เคสที่ 1: ข้อมูลไม่คร่อม 1 ทุ่ม (อยู่ก่อน หรือ อยู่หลัง ไปเลย)
                    SELECT s.[occurred_start], s.[occurred_end], s.[shift]
                    WHERE s.[occurred_start] >= s.[split_shift] OR s.[occurred_end] <= s.[split_shift]
                    UNION ALL
                    -- เคสที่ 2: ข้อมูลคร่อม 1 ทุ่ม (ท่อนแรก: ก่อน 1 ทุ่ม)
                    SELECT s.[occurred_start], s.[split_shift], s.[shift]
                    WHERE s.[split_shift] BETWEEN s.[occurred_start] AND s.[occurred_end] AND s.[occurred_start] < s.[split_shift] AND s.[occurred_end] > s.[split_shift]
                    UNION ALL
                    -- เคสที่ 3: ข้อมูลคร่อม 1 ทุ่ม (ท่อนสอง: หลัง 1 ทุ่มเปลี่ยนเป็นกะ N)
                    SELECT s.[split_shift], s.[occurred_end], 'N'
                    WHERE s.[split_shift] BETWEEN s.[occurred_start] AND s.[occurred_end] AND s.[occurred_start] < s.[split_shift] AND s.[occurred_end] > s.[split_shift]
                ) v
            ),
            [calc] AS (
                SELECT 
                    *,
                    DATEDIFF(SECOND, [occurred_start], [occurred_end]) AS [diff_sec]
                FROM [split_shift]
            )
                SELECT
                    [work_date] AS [operation_day]
                    ,'true' AS [is_operation_day]
                    ,UPPER([process]) AS [process]
                    ,CONCAT('LINE ', CAST(LEFT(RIGHT([mc_no],3),2) AS INT)) AS line_name
                    ,UPPER([mc_no]) AS [machine_name]
                    ,UPPER([mc_status]) AS [status_name]
                    ,SUM([diff_sec]) AS [daily_duration_s]
                    ,COUNT([mc_status]) AS [daily_count]
                    ,SUM(CASE WHEN [shift] = 'M' OR [shift] = 'A' THEN [diff_sec] ELSE 0 END) AS [shift1_duration_s]
                    ,SUM(CASE WHEN [shift] = 'M' OR [shift] = 'A' THEN 1 ELSE 0 END) AS [shift1_count]
                    ,SUM(CASE WHEN [shift] = 'N' OR [shift] = 'B' THEN [diff_sec] ELSE 0 END) AS [shift2_duration_s]
                    ,SUM(CASE WHEN [shift] = 'N' OR [shift] = 'B' THEN 1 ELSE 0 END) AS [shift2_count]
                    ,SUM(CASE WHEN [shift] = 'C' THEN [diff_sec] ELSE 0 END) AS [shift3_duration_s]
                    ,SUM(CASE WHEN [shift] = 'C' THEN 1 ELSE 0 END) AS [shift3_count]
                FROM [calc]
                WHERE mc_no like 'IR%'
                GROUP BY
                    [mc_no]
                    ,[process]
                    ,[work_date]
                    ,[mc_status]
                ORDER BY [operation_day], [machine_name], [status_name]
        `);
        // console.log(dataOR, dataIR)
        let data = [...dataOR[0], ...dataIR[0]]
        
        // STEP INSERT DATA
        if (data.length > 0) {
            const result = data
            for (let index = 0; index < result.length; index++) {
                // console.log(result)
                await sequelize.query(`
                    INSERT INTO [NAT_DX_TO_PICO].[dbo].[GD2ND_DAILY_STATUS_REPORT] ([operation_day],[is_operation_day],[process],[line_name],[machine_name],[status_name],[daily_duration_s],[daily_count],[shift1_duration_s],[shift1_count],[shift2_duration_s],[shift2_count],[shift3_duration_s],[shift3_count],[registered_at])
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
                            SELECT 1
                            FROM [NAT_DX_TO_PICO].[dbo].[GD2ND_DAILY_STATUS_REPORT]
                            WHERE [operation_day] = '${result[index].operation_day}'
                                AND [line_name] = '${result[index].line_name}'
                                AND [machine_name] = '${result[index].machine_name}'
                                AND [status_name] = '${result[index].status_name}'
                                AND [daily_duration_s] = ${result[index].daily_duration_s}
                                AND [daily_count] = ${result[index].daily_count});
                `);
            }
            console.log("NAT - GD2ND - Insert status new Done!");

            return {
                data: data[0],
                success: true,
                message: "Update data complete",
            }
        } else {
            console.log("NAT - GD2ND - Can't new insert : Length = 0");
        }
    } catch (error) {
        console.log("NAT - GD2ND - new status insert error:", error);
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
// NewStatusGetDailyStatusReport('2026-06-10');

module.exports = router;