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
                    'connection lost' AS [status_alarm],
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
            DECLARE @start_date_before DATETIME = DATEADD(HOUR, -1, @start_date);
            DECLARE @end_min_check_status DATETIME = DATEADD(MINUTE, 1, @start_date);

            DECLARE @shift1 VARCHAR(8) = '07:00:00';
            DECLARE @shift2 VARCHAR(8) = '19:00:00';
            DECLARE @split_shift DATETIME = DATEADD(HOUR, 19, CAST(CAST(@start_date AS DATE) AS DATETIME));
            DECLARE @process VARCHAR(8) = '2GD';

            -------------------------------------------------------------------
            -- STEP 1: กวาดข้อมูลจากตารางหลักมาลง Temp Table (ใส่ COLLATE ป้องกัน Error)
            -------------------------------------------------------------------
            IF OBJECT_ID('tempdb..#TempStatus') IS NOT NULL DROP TABLE #TempStatus;
            SELECT 
                [mc_no] COLLATE DATABASE_DEFAULT AS [mc_no], 
                [process] COLLATE DATABASE_DEFAULT AS [process], 
                [occurred],
                CASE WHEN DATEPART(HOUR, [occurred]) < 7 THEN CONVERT(date, DATEADD(DAY, -1, [occurred])) ELSE CONVERT(date, [occurred]) END AS [work_date],
                [mc_status] COLLATE DATABASE_DEFAULT AS [mc_status], 
                [occurred] AS [occurred_start]
            INTO #TempStatus
            FROM [nat_mc_mcshop_2gd].[dbo].[DATA_MCSTATUS_2GD]
            WHERE [occurred] >= DATEADD(DAY, -1, @start_date) AND [occurred] <= @end_date AND mc_no like 'IR%';

            CREATE CLUSTERED INDEX IX_TempStatus ON #TempStatus(mc_no, occurred_start);

            IF OBJECT_ID('tempdb..#TempMonitor') IS NOT NULL DROP TABLE #TempMonitor;
            SELECT
                [mc_no] COLLATE DATABASE_DEFAULT AS [mc_no], 
                [process] COLLATE DATABASE_DEFAULT AS [process],
                CASE WHEN DATEPART(HOUR, [registered]) < 7 THEN CONVERT(date, DATEADD(DAY, -1, [registered])) ELSE CONVERT(date, [registered]) END AS [work_date],
                [registered], CAST([broker] AS FLOAT) AS [broker],
                LAG(CAST([broker] AS FLOAT)) OVER (PARTITION BY [mc_no] ORDER BY [registered]) AS [broker_prv]
            INTO #TempMonitor
            FROM [nat_mc_mcshop_2gd].[dbo].[MONITOR_IOT]
            WHERE [registered] BETWEEN @start_date_before AND @end_date AND mc_no like 'IR%';

            CREATE CLUSTERED INDEX IX_TempMonitor ON #TempMonitor(mc_no, registered);
            -------------------------------------------------------------------
            -- STEP 2: จับข้อมูลมา Merge กันทีละ Step (จัดลำดับใหม่เพื่อดึง Status ย้อนหลังให้ถูกต้อง)
            -------------------------------------------------------------------
            IF OBJECT_ID('tempdb..#TempMerge') IS NOT NULL DROP TABLE #TempMerge;
            CREATE TABLE #TempMerge (
                mc_no NVARCHAR(50) COLLATE DATABASE_DEFAULT, 
                process NVARCHAR(50) COLLATE DATABASE_DEFAULT, 
                work_date DATE, 
                mc_status NVARCHAR(50) COLLATE DATABASE_DEFAULT, 
                occurred_start DATETIME
            );

            -- 2.1 เอา Status ปกติในช่วงเวลาของวันนี้ใส่ลงไป
            INSERT INTO #TempMerge (mc_no, process, work_date, mc_status, occurred_start)
            SELECT mc_no, process, work_date, mc_status, occurred_start
            FROM #TempStatus WHERE occurred_start BETWEEN @start_date AND @end_date;

            -- 2.2 แทรก Connection Lost จาก IOT (กรณีกล่องส่ง 0)
            INSERT INTO #TempMerge (mc_no, process, work_date, mc_status, occurred_start)
            SELECT mc_no, process, work_date, 'connection lost', registered
            FROM #TempMonitor
            WHERE (broker_prv = 1 AND broker = 0 AND registered BETWEEN @start_date AND @end_date)
            OR (registered BETWEEN @start_date AND @end_min_check_status AND broker_prv = 0 AND broker = 0);

            -- 2.3 แทรก Recovery (กรณีกล่องกลับมาส่ง 1 แต่ไม่มี Status)
            INSERT INTO #TempMerge (mc_no, process, work_date, mc_status, occurred_start)
            SELECT 
                m.mc_no, m.process, m.work_date,
                -- เมื่อกล่องเปลี่ยนจาก 0 เป็น 1 แต่ไม่มี status ส่งมาในรอบ +- 5 นาที ให้ดึง status ล่าสุดก่อนหน้านั้นมาใส่
                CASE 
                    WHEN NOT EXISTS (
                        SELECT 1 FROM #TempStatus s
                        WHERE s.mc_no = m.mc_no
                        AND (s.occurred_start > m.registered OR s.occurred_start BETWEEN DATEADD(MINUTE, -5, m.registered) AND DATEADD(MINUTE, 5, m.registered))
                        AND s.occurred_start <= @end_date
                    ) THEN 'connection lost' --ถ้าหลังจาก broker กลับมาเป็น 1 แต่ไม่มี status ส่งมาเลย ให้เป็น connection lost
                    ELSE ISNULL(last_s.mc_status, 'connection lost')
                END AS mc_status,
                m.registered
            FROM #TempMonitor m
            OUTER APPLY (
                SELECT TOP 1 
                    s.mc_status,
                    -- แตกตัวเช็กแยกต่างหากว่า ตัวล่าสุดที่เจอตัวนี้ อยู่ในพิกัด +- 5 นาทีหรือไม่
                    IIF(s.occurred_start BETWEEN DATEADD(MINUTE, -5, m.registered) AND DATEADD(MINUTE, 5, m.registered), 1, 0) AS is_near
                FROM #TempStatus s
                WHERE s.mc_no = m.mc_no 
                AND s.occurred_start <= DATEADD(MINUTE, 5, m.registered)
                -- ดึงข้อมูลเก่าล่าสุดย้อนหลังได้ 1 วันเต็ม (ข้อมูลถูกเตรียมไว้ใน #TempStatus ตั้งแต่แรกแล้ว)
                AND s.occurred_start >= DATEADD(DAY, -1, m.registered) 
                ORDER BY s.occurred_start DESC
            ) last_s
            WHERE m.broker_prv = 0 AND m.broker = 1 
            AND m.registered BETWEEN @start_date AND @end_date
            AND (last_s.is_near IS NULL OR last_s.is_near = 0);

            -- 2.4 แทรก First Status (ดึงตัวล่าสุดที่ค้างอยู่จาก 7 วันก่อนหน้า มาเป็นเวลาเริ่มกะ)
            WITH [first_status] AS (
                SELECT mc_no, process, CONVERT(date, occurred_start) AS work_date, mc_status, CAST(CAST(@start_date AS DATE) AS DATETIME) AS occurred_start,
                    ROW_NUMBER() OVER (PARTITION BY mc_no ORDER BY occurred_start DESC) as rn
                FROM #TempStatus 
                WHERE occurred_start < @start_date AND occurred_start >= DATEADD(DAY, -1, @start_date)
            )
            INSERT INTO #TempMerge (mc_no, process, work_date, mc_status, occurred_start)
            SELECT f.mc_no, f.process, f.work_date, f.mc_status, f.occurred_start
            FROM [first_status] f
            WHERE f.rn = 1 
            -- เช็คเพื่อความชัวร์ว่า: IoT ไม่ได้แจ้งเตือนว่ากล่องดับ 0 ตั้งแต่เปิดกะ (ถ้ายืนยันว่าดับจริง จะไม่เอาอดีตมาทับ)
            AND NOT EXISTS (
                SELECT 1 FROM #TempMerge m 
                WHERE m.mc_no = f.mc_no 
                    AND m.mc_status = 'connection lost' 
                    AND m.occurred_start BETWEEN @start_date AND @end_min_check_status
            );

            -- 2.5 แทรก Connection Lost สำหรับเครื่องที่ "หายสาบสูญ" จริงๆ
            -- (คือวันนี้ไม่มี Log อะไรเลย, และย้อนหลังไป 7 วัน ก็ไม่มี Log เหลืออยู่เลย)
            INSERT INTO #TempMerge (mc_no, process, work_date, mc_status, occurred_start)
            SELECT a.mc_no, @process, CAST(@start_date AS DATE), 'connection lost', @start_date
            FROM (SELECT DISTINCT mc_no COLLATE DATABASE_DEFAULT AS mc_no FROM [nat_mc_mcshop_2gd].[dbo].[DATA_PRODUCTION_2GD] WHERE registered >= DATEADD(DAY, -1, @start_date) AND mc_no like 'IR%') a
            WHERE NOT EXISTS (
                -- เช็คจากกระบะทรายเลยว่าเครื่องนี้มี Status (ไม่ว่าจะของวันนี้หรืออดีต 7 วัน) ติดมาบ้างไหม ถ้าไม่มีเลยค่อยฟ้อง lost
                SELECT 1 FROM #TempMerge m 
                WHERE m.mc_no = a.mc_no
            );

            -------------------------------------------------------------------
            -- STEP 3: ประมวลผลขั้นสุดท้าย (คำนวณวินาที และกรุ๊ปปิ้ง)
            -------------------------------------------------------------------
            WITH [set_occurred] AS (
                SELECT *, LEAD(occurred_start) OVER (PARTITION BY mc_no ORDER BY occurred_start) AS occurred_end
                FROM #TempMerge
            ),
            [set_time] AS (
                SELECT mc_no, process, CAST(@start_date AS DATE) AS work_date, mc_status,
                    CASE WHEN (occurred_start < @start_date) OR (mc_status = 'connection lost' AND occurred_start BETWEEN @start_date AND @end_min_check_status) THEN @start_date ELSE occurred_start END AS occurred_start,
                    CASE WHEN (occurred_end IS NULL AND occurred_start BETWEEN @start_date AND @end_min_check_status) OR (occurred_end IS NULL) THEN @end_date ELSE occurred_end END AS occurred_end
                FROM [set_occurred]
                WHERE (occurred_end > @start_date AND occurred_start < @end_date) OR mc_status = 'connection lost' OR occurred_end IS NULL
            ),
            [set_cl] AS (
                -- ถ้า [occurred_start] ไม่ได้เท่ากับ @start_date ก็ให้ทำเป็น connection lost
                SELECT * FROM [set_time]
                UNION ALL
                SELECT
                    [mc_no],
                    [process],
                    [work_date],
                    'connection lost' AS [mc_status],
                    @start_date AS [occurred_start],
                    MIN([occurred_start]) AS [occurred_end]
                FROM [set_time]
                GROUP BY [mc_no], [process], [work_date]
                HAVING MIN([occurred_start]) > @start_date
            ),
            [shift] AS (
                SELECT *,
                    CASE WHEN CONVERT(TIME, occurred_start) BETWEEN @shift1 AND @shift2 THEN 'M' ELSE 'N' END AS [shift],
                    @split_shift AS split_shift
                FROM [set_cl]
            ),
            [split_shift] AS (
                SELECT s.mc_no, s.process, s.work_date, s.mc_status, v.occurred_start, v.occurred_end, v.shift
                FROM [shift] s
                CROSS APPLY (
                    SELECT s.occurred_start, s.occurred_end, s.shift WHERE s.occurred_start >= s.split_shift OR s.occurred_end <= s.split_shift
                    UNION ALL SELECT s.occurred_start, s.split_shift, s.shift WHERE s.split_shift > s.occurred_start AND s.split_shift < s.occurred_end
                    UNION ALL SELECT s.split_shift, s.occurred_end, 'N' WHERE s.split_shift > s.occurred_start AND s.split_shift < s.occurred_end
                ) v
            ),
            [calc] AS (
                SELECT *, DATEDIFF(SECOND, occurred_start, occurred_end) AS diff_sec FROM [split_shift]
                --order by mc_no, occurred_start
            )
            SELECT
                work_date AS operation_day, 
                'true' AS is_operation_day, 
                @process AS process,
                CONCAT('LINE ', CAST(LEFT(RIGHT([mc_no],3),2) AS INT)) AS line_name,
                UPPER(mc_no) AS machine_name, 
                UPPER(mc_status) AS status_name,
                SUM(diff_sec) AS daily_duration_s, 
                COUNT(mc_status) AS daily_count,
                SUM(CASE WHEN shift IN ('M', 'A') THEN diff_sec ELSE 0 END) AS shift1_duration_s, 
                SUM(CASE WHEN shift IN ('M', 'A') THEN 1 ELSE 0 END) AS shift1_count,
                SUM(CASE WHEN shift IN ('N', 'B') THEN diff_sec ELSE 0 END) AS shift2_duration_s, 
                SUM(CASE WHEN shift IN ('N', 'B') THEN 1 ELSE 0 END) AS shift2_count,
                SUM(CASE WHEN shift = 'C' THEN diff_sec ELSE 0 END) AS shift3_duration_s, 
                SUM(CASE WHEN shift = 'C' THEN 1 ELSE 0 END) AS shift3_count
            FROM calc
            GROUP BY mc_no, process, work_date, mc_status
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