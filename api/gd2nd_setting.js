const express = require("express");
const sequelize = require("../instance/db");
const cron = require("node-cron");
const moment = require("moment-timezone");

const router = express.Router();

cron.schedule(
  "1 7 * * *",
  async () => {
    let dateToday;
    const hours = parseInt(moment().tz("Asia/Bangkok").format("HH"), 10);

    if (hours <= 7) {
      dateToday = moment()
        .tz("Asia/Bangkok")
        .subtract(1, "days")
        .format("YYYY-MM-DD");
    } else {
      dateToday = moment().tz("Asia/Bangkok").format("YYYY-MM-DD");
    }

    await getDailySettingReport();
    console.log(
      "Running data setting cron job for date:",
      dateToday,
      hours,
      moment().tz("Asia/Bangkok").format("YYYY-MM-DD HH:mm:ss")
    );
  },
  {
    timezone: "Asia/Bangkok",
  }
);

const getDailySettingReport = async () => {
  try {
    let data = await sequelize.query(
      `SELECT
            'GD' AS[process],
            CONCAT('LINE ', line_no) AS line_no,
        [mc_no],
            CASE WHEN mc_no LIKE '%B' THEN
                1
            WHEN mc_no LIKE '%R' THEN
                2
            WHEN mc_no LIKE '%H' THEN
                3
            ELSE
                1
            END AS [mc_order],
            '7:00:00' AS shift_start,
            1 AS count_f,
            CASE WHEN mc_no LIKE 'IC-52%'
                OR mc_no LIKE 'IR58%'
                OR mc_no LIKE 'IR64%'
                OR mc_no LIKE 'OC24H%'
                OR mc_no LIKE 'OC45H%' THEN
                2000
            WHEN mc_no LIKE 'IC01%'
                OR mc_no LIKE 'IC02%'
                OR mc_no LIKE 'IC03%'
                OR mc_no LIKE 'IC04%'
                OR mc_no LIKE 'IC05%'
                OR mc_no LIKE 'IC06%'
                OR mc_no LIKE 'IC07%'
                OR mc_no LIKE 'IC08%'
                OR mc_no LIKE 'IC09%'
                OR mc_no LIKE 'IC10%'
                OR mc_no LIKE 'IC11%'
                OR mc_no LIKE 'IC12%'
                OR mc_no LIKE 'IC13%'
                OR mc_no LIKE 'IC14%'
                OR mc_no LIKE 'IC15%'
                OR mc_no LIKE 'IC16%'
                OR mc_no LIKE 'IC18%'
                OR mc_no LIKE 'IC19%'
                OR mc_no LIKE 'IC21%'
                OR mc_no LIKE 'IC23%'
                OR mc_no LIKE 'IC24%'
                OR mc_no LIKE 'IC25%'
                OR mc_no LIKE 'IC26%'
                OR mc_no LIKE 'IC27%'
                OR mc_no LIKE 'IC28%'
                OR mc_no LIKE 'IC29%'
                OR mc_no LIKE 'IC30%'
                OR mc_no LIKE 'IC31%'
                OR mc_no LIKE 'IC33%'
                OR mc_no LIKE 'IC34%'
                OR mc_no LIKE 'IC35%'
                OR mc_no LIKE 'IC36%'
                OR mc_no LIKE 'IC37%'
                OR mc_no LIKE 'IC38%'
                OR mc_no LIKE 'IC39%'
                OR mc_no LIKE 'IC40%'
                OR mc_no LIKE 'IC41%'
                OR mc_no LIKE 'IC42%'
                OR mc_no LIKE 'IC43%'
                OR mc_no LIKE 'IC45%'
                OR mc_no LIKE 'IC46%'
                OR mc_no LIKE 'IC47%'
                OR mc_no LIKE 'IC48%'
                OR mc_no LIKE 'IC49%'
                OR mc_no LIKE 'IC50%'
                OR mc_no LIKE 'IC51%'
                OR mc_no LIKE 'IR44%'
                OR mc_no LIKE 'IR46%'
                OR mc_no LIKE 'IR47%'
                OR mc_no LIKE 'IR48%'
                OR mc_no LIKE 'IR50%'
                OR mc_no LIKE 'IR51%'
                OR mc_no LIKE 'IR52%'
                OR mc_no LIKE 'IR54%'
                OR mc_no LIKE 'IR55%'
                OR mc_no LIKE 'IR56%'
                OR mc_no LIKE 'IR57%'
                OR mc_no LIKE 'IR59%'
                OR mc_no LIKE 'IR60%'
                OR mc_no LIKE 'IR61%' THEN
                2370
            WHEN mc_no LIKE 'IC17%'
                OR mc_no LIKE 'IC32%'
                OR mc_no LIKE 'IR49%'
                OR mc_no LIKE 'IR53%' THEN
                2600
            WHEN mc_no LIKE 'IC20%'
                OR mc_no LIKE 'IC22%' THEN
                3400
            ELSE
                NULL
            END AS ct
        FROM
            [data_machine_gd2].[dbo].[master_mc_run_parts]
            `
    );

    // STEP CHECK/INSERT DATA
    if (data[0].length > 0) {
      const result = data[0];
      for (let index = 0; index < result.length; index++) {
        const { process, line_no, mc_no, mc_order, shift_start, count_f, ct } =
          result[index];

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
                              FROM [NHT_DX_TO_PICO].[dbo].[GD2ND_SETTING]
                  WHERE machine_name = ?
                  `,
          {
            replacements: [mc_no],
            type: sequelize.QueryTypes.SELECT,
          }
        );

        if (check.length === 0) {
          // ไม่พบ machine นี้ => INSERT ใหม่
          await sequelize.query(
            `
                    INSERT INTO [NHT_DX_TO_PICO].[dbo].[GD2ND_SETTING] ([process], [line_name], [machine_name], [machine_order], [shift1_start_time], [count_factor], [target_cycle_time_ms], [registered_at])
                    VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE())
                    `,
            {
              replacements: [
                process,
                line_no,
                mc_no,
                mc_order,
                shift_start,
                count_f,
                ct,
              ],
            }
          );
        } else {
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
            console.log("GD2ND - !isSame", !isSame);

            // ไม่เหมือนกัน → del แล้ว Insert ใหม่

            await sequelize.query(
              `DELETE FROM [NHT_DX_TO_PICO].[dbo].[GD2ND_SETTING] WHERE machine_name = ?`,
              {
                replacements: [mc_no],
              }
            );
            await sequelize.query(
              `
                    INSERT INTO [NHT_DX_TO_PICO].[dbo].[GD2ND_SETTING] ([process], [line_name], [machine_name], [machine_order], [shift1_start_time], [count_factor], [target_cycle_time_ms], [registered_at])
                    VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE())
                    `,
              {
                replacements: [
                  process,
                  line_no,
                  mc_no,
                  mc_order,
                  shift_start,
                  count_f,
                  ct,
                ],
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
      };
    }
  } catch (error) {
    console.log("status insert error:", error);
    return {
      data: error.message,
      success: true,
      message: "Can't update data",
    };
  }
};

router.get("gd_setting_to_insert", async (res, req) => {
  try {
    let data = await sequelize.query(
      `SELECT
    'GD' AS[process],
    CONCAT('LINE ', line_no) AS line_no,
[mc_no],
    CASE WHEN mc_no LIKE '%B' THEN
        1
    WHEN mc_no LIKE '%R' THEN
        2
    WHEN mc_no LIKE '%H' THEN
        3
    ELSE
        1
    END AS [mc_order],
    '7:00:00' AS shift_start,
    1 AS count_f,
    CASE WHEN mc_no LIKE 'IC-52%'
        OR mc_no LIKE 'IR58%'
        OR mc_no LIKE 'IR64%'
        OR mc_no LIKE 'OC24H%'
        OR mc_no LIKE 'OC45H%' THEN
        2000
    WHEN mc_no LIKE 'IC01%'
        OR mc_no LIKE 'IC02%'
        OR mc_no LIKE 'IC03%'
        OR mc_no LIKE 'IC04%'
        OR mc_no LIKE 'IC05%'
        OR mc_no LIKE 'IC06%'
        OR mc_no LIKE 'IC07%'
        OR mc_no LIKE 'IC08%'
        OR mc_no LIKE 'IC09%'
        OR mc_no LIKE 'IC10%'
        OR mc_no LIKE 'IC11%'
        OR mc_no LIKE 'IC12%'
        OR mc_no LIKE 'IC13%'
        OR mc_no LIKE 'IC14%'
        OR mc_no LIKE 'IC15%'
        OR mc_no LIKE 'IC16%'
        OR mc_no LIKE 'IC18%'
        OR mc_no LIKE 'IC19%'
        OR mc_no LIKE 'IC21%'
        OR mc_no LIKE 'IC23%'
        OR mc_no LIKE 'IC24%'
        OR mc_no LIKE 'IC25%'
        OR mc_no LIKE 'IC26%'
        OR mc_no LIKE 'IC27%'
        OR mc_no LIKE 'IC28%'
        OR mc_no LIKE 'IC29%'
        OR mc_no LIKE 'IC30%'
        OR mc_no LIKE 'IC31%'
        OR mc_no LIKE 'IC33%'
        OR mc_no LIKE 'IC34%'
        OR mc_no LIKE 'IC35%'
        OR mc_no LIKE 'IC36%'
        OR mc_no LIKE 'IC37%'
        OR mc_no LIKE 'IC38%'
        OR mc_no LIKE 'IC39%'
        OR mc_no LIKE 'IC40%'
        OR mc_no LIKE 'IC41%'
        OR mc_no LIKE 'IC42%'
        OR mc_no LIKE 'IC43%'
        OR mc_no LIKE 'IC45%'
        OR mc_no LIKE 'IC46%'
        OR mc_no LIKE 'IC47%'
        OR mc_no LIKE 'IC48%'
        OR mc_no LIKE 'IC49%'
        OR mc_no LIKE 'IC50%'
        OR mc_no LIKE 'IC51%'
        OR mc_no LIKE 'IR44%'
        OR mc_no LIKE 'IR46%'
        OR mc_no LIKE 'IR47%'
        OR mc_no LIKE 'IR48%'
        OR mc_no LIKE 'IR50%'
        OR mc_no LIKE 'IR51%'
        OR mc_no LIKE 'IR52%'
        OR mc_no LIKE 'IR54%'
        OR mc_no LIKE 'IR55%'
        OR mc_no LIKE 'IR56%'
        OR mc_no LIKE 'IR57%'
        OR mc_no LIKE 'IR59%'
        OR mc_no LIKE 'IR60%'
        OR mc_no LIKE 'IR61%' THEN
        2370
    WHEN mc_no LIKE 'IC17%'
        OR mc_no LIKE 'IC32%'
        OR mc_no LIKE 'IR49%'
        OR mc_no LIKE 'IR53%' THEN
        2600
    WHEN mc_no LIKE 'IC20%'
        OR mc_no LIKE 'IC22%' THEN
        3400
    ELSE
        NULL
    END AS ct
FROM
    [data_machine_gd2].[dbo].[master_mc_run_parts]
    `
    );
  } catch (error) {
    console.log(error.message);
  }
});

module.exports = router;
