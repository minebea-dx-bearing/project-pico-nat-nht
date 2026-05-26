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

    await getDailySettingReport();
    console.log("NAT - ANT - Running data setting cron job for date:", dateToday, hours, moment().tz('Asia/Bangkok').format("YYYY-MM-DD HH:mm:ss"));
}, {
    timezone: "Asia/Bangkok"
});

const getDailySettingReport = async () => {
    try {
        let data = await dbNAT.query(`
            WITH [rnr] AS (
                SELECT DISTINCT
                    UPPER(a.[mc_no]) AS [mc_no],
                    UPPER(a.[process]) AS [process],
                    5 AS [mc_order],
                    '6:00:00' AS [shift_start],
                    b.[ring_factor] AS [count_f],
                    b.[target_ct] * 1000 AS [ct],
                    ROW_NUMBER() OVER (PARTITION BY a.[mc_no] ORDER BY b.[registered] DESC) AS rn
                FROM [nat_mc_assy_ant_new].[dbo].[DATA_PRODUCTION_ANT] a
				        LEFT JOIN [nat_mc_assy_ant_new].[dbo].[DATA_MASTER_ANT] b ON a.mc_no = b.mc_no
            ),
			      [rnf] AS (
                SELECT DISTINCT
                    UPPER(a.[mc_no]) AS [mc_no],
                    UPPER(a.[process]) AS [process],
                    5 AS [mc_order],
                    '6:00:00' AS [shift_start],
                    b.[ring_factor] AS [count_f],
                    b.[target_ct] * 1000 AS [ct],
                    ROW_NUMBER() OVER (PARTITION BY a.[mc_no] ORDER BY b.[registered] DESC) AS rn
                FROM [nat_mc_assy_ant_new].[dbo].[DATA_PRODUCTION_ANT] a
				    LEFT JOIN [nat_mc_assy_ant_new].[dbo].[DATA_MASTER_ANT] b ON a.mc_no = b.mc_no
            ),
            [merge] AS (
              SELECT
                LEFT([mc_no], 3) + '0' + CONVERT(VARCHAR(10), CONVERT(INT, RIGHT([mc_no], 2)) + (CONVERT(INT, RIGHT([mc_no], 2)) - 1)) AS [mc_no],
                [process],
                [mc_order],
                [shift_start],
                [count_f],
                [ct]
              FROM [rnr]
              where rn = 1
              UNION
              SELECT
                LEFT([mc_no], 3) + '0' + CONVERT(VARCHAR(10), (CONVERT(INT, RIGHT([mc_no], 2)) * 2)) AS [mc_no],
                [process],
                [mc_order],
                [shift_start],
                [count_f],
                [ct]
              FROM [rnf]
              where rn = 1
            )
            SELECT 
                *,
                CONCAT('LINE ', CAST(RIGHT([mc_no],2) AS INT)) AS [line_no]
            FROM [merge]
            ORDER BY [mc_no]
        `)
           
        // STEP CHECK/INSERT DATA
        if (data[0].length > 0) {
            const result = data[0]
            for (let index = 0; index < result.length; index++) {
                const { process, line_no, mc_no, mc_order, shift_start, count_f, ct } = result[index];
              
                const check = await sequelize.query(
                  `
                  SELECT [process]
                      ,[line_name]
                      ,[machine_name]
                      ,[machine_order]
                      ,[shift1_start_time]
                      ,[count_factor]
                      ,[target_cycle_time_ms]
                      ,[registered_at]
                  FROM [NAT_DX_TO_PICO].[dbo].[ANT_SETTING]
                  WHERE machine_name = ?
                  `,
                  {
                    replacements: [mc_no],
                    type: sequelize.QueryTypes.SELECT
                  }
                );
              
                if (check.length === 0) {
                  // ไม่พบ machine นี้ => INSERT ใหม่
                  console.log([process, line_no, mc_no, mc_order, shift_start, count_f, ct])
                  await sequelize.query(
                    `
                    INSERT INTO [NAT_DX_TO_PICO].[dbo].[ANT_SETTING] ([process], [line_name], [machine_name], [machine_order], [shift1_start_time], [count_factor], [target_cycle_time_ms], [registered_at])
                    VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE())
                    `,
                    {
                      replacements: [process, line_no, mc_no, mc_order, shift_start, count_f, ct]
                    }
                  );
                } 
                else {
                  const existing = check[0];
              
                  // check process, line_name, target_cycle_time_ms เหมือนกันหรือไม่
                  const isSame =
                    existing.process === process &&
                    existing.line_name === line_no &&
                    existing.shift1_start_time === shift_start &&
                    Number(existing.machine_order) === Number(mc_order) &&
                    Number(existing.count_factor) === Number(count_f) &&
                    Number(existing.target_cycle_time_ms) === Number(ct);
              
                  if (!isSame) {
                    console.log("NAT - ANT - !isSame", !isSame);
                    
                    // ไม่เหมือนกัน → del แล้ว Insert ใหม่
                    await sequelize.query(
                      `
                      DELETE FROM [NAT_DX_TO_PICO].[dbo].[ANT_SETTING] WHERE machine_name = ?;
                      `,
                      {
                        replacements: [mc_no],
                      }
                    );

                    await sequelize.query(
                      `
                      INSERT INTO [NAT_DX_TO_PICO].[dbo].[ANT_SETTING] ([process], [line_name], [machine_name], [machine_order], [shift1_start_time], [count_factor], [target_cycle_time_ms], [registered_at])
                      VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE())
                      `,
                      {
                        replacements: [process, line_no, mc_no, mc_order, shift_start, count_f, ct]
                      }
                    );
                  }
                  // ถ้าเหมือน => ไม่ต้องทำอะไร
                }
              }

            return {
                data: data[0],
                success: true,
                message: "Update data complete",
            }
        }

    } catch (error) {
        console.log("NAT - ANT - status insert error:" , error);
        return {
            data: error.message,
            success: true,
            message: "Can't update data",
        }
    }
}

module.exports = router;
