const express = require('express');
const app = express();
const port = process.env.PORT || 5000;

// GD2ND NHT
app.use("/api/gd2nd_setting", require("./api/gd2nd_setting"));
app.use("/api/gd2nd_status", require("./api/gd2nd_status"));
app.use("/api/gd2nd_daily_report", require("./api/gd2nd_daily_report"));

// MBR NHT
app.use("/api/mbr_setting", require("./api/mbr_setting"));
app.use("/api/mbr_status", require("./api/mbr_status"));
app.use("/api/mbr_daily_report", require("./api/mbr_daily_report"));

// GSSM NHT
app.use("/api/gssm_setting", require("./api/gssm_setting"));
app.use("/api/gssm_status", require("./api/gssm_status"));
app.use("/api/gssm_daily_report", require("./api/gssm_daily_report"));

// FIM NHT
app.use("/api/fim_setting", require("./api/fim_setting"));
app.use("/api/fim_status", require("./api/fim_status"));
app.use("/api/fim_daily_report", require("./api/fim_daily_report"));

// ANT NHT
app.use("/api/ant_setting", require("./api/ant_setting"));
app.use("/api/ant_status", require("./api/ant_status"));
app.use("/api/ant_daily_report", require("./api/ant_daily_report"));

// AOD NHT
app.use("/api/aod_setting", require("./api/aod_setting"));
app.use("/api/aod_status", require("./api/aod_status"));
app.use("/api/aod_daily_report", require("./api/aod_daily_report"));

// AVS NHT
app.use("/api/avs_setting", require("./api/avs_setting"));
app.use("/api/avs_status", require("./api/avs_status"));
app.use("/api/avs_daily_report", require("./api/avs_daily_report"));

// ALU NHT
app.use("/api/alu_setting", require("./api/alu_setting"));
app.use("/api/alu_status", require("./api/alu_status"));
app.use("/api/alu_daily_report", require("./api/alu_daily_report"));

// ------------------------------ NAT API ------------------------------ //
// TN NAT
app.use("/api/tn_nat_setting", require("./api_nat/tn_setting"));
app.use("/api/tn_nat_status", require("./api_nat/tn_status"));
app.use("/api/tn_nat_daily_report", require("./api_nat/tn_daily_report"));

// GD2ND NAT
app.use("/api/gd2nd_nat_setting", require("./api_nat/gd2nd_setting"));
app.use("/api/gd2nd_nat_status", require("./api_nat/gd2nd_status"));
app.use("/api/gd2nd_nat_daily_report", require("./api_nat/gd2nd_daily_report"));

// MBR NAT
app.use("/api/mbr_nat_setting", require("./api_nat/mbr_setting"));
app.use("/api/mbr_nat_status", require("./api_nat/mbr_status"));
app.use("/api/mbr_nat_daily_report", require("./api_nat/mbr_daily_report"));

// ARP NAT
app.use("/api/arp_nat_setting", require("./api_nat/arp_setting"));
app.use("/api/arp_nat_status", require("./api_nat/arp_status"));
app.use("/api/arp_nat_daily_report", require("./api_nat/arp_daily_report"));

// GSSM NAT
app.use("/api/gssm_nat_setting", require("./api_nat/gssm_setting"));
app.use("/api/gssm_nat_status", require("./api_nat/gssm_status"));
app.use("/api/gssm_nat_daily_report", require("./api_nat/gssm_daily_report"));

// FIM NAT
app.use("/api/fim_nat_setting", require("./api_nat/fim_setting"));
app.use("/api/fim_nat_status", require("./api_nat/fim_status"));
app.use("/api/fim_nat_daily_report", require("./api_nat/fim_daily_report"));

// ANT NAT
app.use("/api/ant_nat_setting", require("./api_nat/ant_setting"));
app.use("/api/ant_nat_status", require("./api_nat/ant_status"));
app.use("/api/ant_nat_daily_report", require("./api_nat/ant_daily_report"));

// AOD NAT
app.use("/api/aod_nat_setting", require("./api_nat/aod_setting"));
app.use("/api/aod_nat_status", require("./api_nat/aod_status"));
app.use("/api/aod_nat_daily_report", require("./api_nat/aod_daily_report"));

// AVS NAT
app.use("/api/avs_nat_setting", require("./api_nat/avs_setting"));
app.use("/api/avs_nat_status", require("./api_nat/avs_status"));
app.use("/api/avs_nat_daily_report", require("./api_nat/avs_daily_report"));

// ALU NAT
app.use("/api/alu_nat_setting", require("./api_nat/alu_setting"));
app.use("/api/alu_nat_status", require("./api_nat/alu_status"));
app.use("/api/alu_nat_daily_report", require("./api_nat/alu_daily_report"));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
