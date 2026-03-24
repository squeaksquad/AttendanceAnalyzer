Open the Web App

Preparing Files for the Attendance Analyzer

The reports that are needed from WhenIWork within the desired date range are:
- Absences Report (stock WhenIWork)
- Shift Requests (stock WhenIWork)
- Shifts Worked (custom Shifts report, details below)
- Timesheets Report (stock WhenIWork)

Click “Point to folder” to select the folder that (only) the four files live in, or drag the four files into the window.

If you want to analyze the semester in two halves, you can upload two sets of data, there is an optional “Period 2” that can be used for the time between midterms and finals.

“Period 1” and “Period 2” also work around the WhenIWork date range limitations, so we can just run two sets of reports for each half of the semester and this app will stitch it all together.


The row groups and sum values are what the webapp is expecting to see, and shows which shifts a person clocked in to or didn’t clock in to.




Make sure you have these things selected, and that they’re organized in this order. The app can probably correct for a different order, but might as well make things easy for it.

The columns shown in the image to the left are necessary for the algorithm to process data correctly, as are the row groups and summing values shown above.

How to Use:

Once files are loaded properly, they’ll show as green and all three boxes will be highlighted in the sidebar on the left. The Timesheets report is technically optional, but helps when correcting for inconsistencies in clock data, as outlined in a later section of this guide. When loaded in it’ll show as 4/3 matched if you have the optional Timesheets file loaded.

Click “Analyze” in the sidebar to process the data.

You probably won’t have to adjust the Timezone corrector, since we’re processing data that is only relevant to work locations in Boston.

The bar on the top will also update to show the date range from the information in the spreadsheets that we imported earlier. Since closing shifts end at midnight, the period shown will look like it goes into the next day, but that’s because it’s analyzing shifts through the full day on 3/13 (in this example).


The main window shows a breakdown of numbers and a list of the students. There’s also a checkbox for “At Risk only” which shows assistants that have attendance below 80%.

Clicking on an assistant’s name will scroll their name to the top (and collapse any previous selection), and show details for the shift history, absences, and shift drop data with the ability to sort newest first or oldest first on the shift history view.

Important Note:

Sometimes if someone has shifts from 11am-1pm, 1pm-4pm, and then 4pm-8pm for example and clocks in from 11am-8pm, they would normally be shown as not having worked the 1pm-4pm and 4pm-8pm shifts. There is a button to correct for that, and it will then update all the calculations. Each entry is shown as having been corrected, and can be undone globally or individually if needed.


If there is “No Clock-In” listed for a shift, it most likely means the assistant did not attend the shift, but if there was also no absence or drop listed for that shift, there’s a chance they just forgot to clock in that day, so attendance may look worse than it actually is but either way that’s something that should be addressed with the assistant (missing clock-ins but still being at the shift).

When meeting with an assistant, if you can confirm that they did work the shift but missed the clock-in, you can manually mark the shift as worked, and it will update the numbers accordingly. This can help get the most accurate picture of their attendance. If you do manually mark any shifts, you should then go back into WhenIWork after the fact and correct their timesheet, that way when we run attendance reports again those shifts will just show as worked.

If an assistant’s missed shift has an absence on file (either self or staff-reported), the entry that doesn’t have a clock entry will also show “Absence on file” so you can easily see when they missed clock in and it may not have been marked by them or staff (so they may have actually worked the shift).

Prep/Closing Shifts:

In the top right of the window, there’s a toggle that says “Attendance” and “Prep & Closing Shifts”.

If you click on “Prep & Closing Shifts”, you will see a view that shows how someone is doing on their weekly prep and closing shift requirements. N/A means they did not work a meaningful amount of prep/closing shifts in the period being analyzed. When there’s a 1/1 or 2/2, etc that represents the overall amount of weekly shifts they worked, so if they had 7 prep shifts on Tuesday and worked all 7, that would be a 1/1. There are percentages shown but I’ve set a 50% attendance threshold for prep/closing requirements for now.

Similar to the other view, you can select “Issues only” to show instances of assistants with low regular attendance of prep/closing shifts.
If you click on an assistant’s name, you can expand the view and see specific shifts that were worked/missed.

Archival:

Once data has been analyzed, there is a button called “Export Snapshot (shareable)”. This button allows the page to spit out a .html file that can be opened with any browser that will essentially run the webapp for that selected period that was exported. This can be handy for archival purposes since it’s literally a snapshot of the attendance for a given period, and doesn’t rely on any sort of extra reporting being done. We can store that data in a folder on the Management Google Drive. Only note is that if you want to open that file, just right click the file, hover on “Open With”, and then select your browser. It’ll just open in a new tab. The normal double-click preview in Google Drive will just show lines of code.

