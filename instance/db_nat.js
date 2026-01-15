//Reference
const Sequelize = require("sequelize");
//=========================================================
const dbNAT = new Sequelize("nat_mc_assy_gssm", "sa", "Natsa@admin", {
  host: "10.128.16.107", // ถ้า connect db ไม่ได้ (ข้อมูลต้องใส่ถูกแล้วด้วย) ให้เปลี่ยนเป็นน "host"
  timezone: "utc+7",
  dialect: "mssql",

  logging: false,
  dialectOptions: {
    keepAlive: true, // Enables connection keep-alive
    
    options: {
      instanceName: "",
      encrypt: false,
      requestTimeout: 300000, // เพิ่ม timeout เป็น 5 นาที
      connectTimeout: 600000, // 600 วินาที หรือ 10 นาที
    },
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 180000, // 60 seconds
    idle: 20000,
  },
});

(async () => {
  await dbNAT.authenticate();
})();
module.exports = dbNAT;
