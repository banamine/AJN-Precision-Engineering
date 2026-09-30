import { getChannelSchedule } from "./channels.ts";
getChannelSchedule().then(res => console.log("Success! Channels:", res.length)).catch(console.error);
