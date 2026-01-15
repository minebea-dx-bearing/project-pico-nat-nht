const express = require('express');
const app = express();
const port = process.env.PORT || 5000;

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
// AN NHT
app.use("/api/an_setting", require("./api/an_setting"));
app.use("/api/an_status", require("./api/an_status"));
app.use("/api/an_daily_report", require("./api/an_daily_report"));

// ------------------------------ NAT API ------------------------------ //
// GSSM NAT
app.use("/api/gssm_nat_setting", require("./api_nat/gssm_setting"));
app.use("/api/gssm_nat_status", require("./api_nat/gssm_status"));
app.use("/api/gssm_nat_daily_report", require("./api_nat/gssm_daily_report"));

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
