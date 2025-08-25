// components
import AdminSidebar from "./AdminSidebar";
import AdminHeader from "../../components/AdminHeader";
import AdminInstructors from "./AdminInstructors";
import AdminSimulationGroups from "./AdminSimulationGroups";
import AdminCreateSimulationGroup from "./AdminCreateSimulationGroup";
import AISettings from "./AISettings";
import PageContainer from "../Container";
import InstructorDetails from "./InstructorDetails";
import GroupDetails from "./GroupDetails";
// MUI
import { AppBar } from "@mui/material";
import { useState } from "react";

export const AdminHomepage = () => {
  const [selectedComponent, setSelectedComponent] =
    useState("AdminInstructors");
  const [selectedInstructor, setSelectedInstructor] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);

  // sidebar routing
  const renderComponent = () => {
    if (selectedInstructor) {
      return (
        <InstructorDetails
          instructorData={selectedInstructor.row}
          onBack={() => setSelectedInstructor(null)}
        />
      );
    }
    if (selectedGroup) {
      return (
        <GroupDetails
          group={selectedGroup.row}
          onBack={() => setSelectedGroup(null)}
        />
      );
    }
    switch (selectedComponent) {
      case "AdminInstructors":
        return (
          <AdminInstructors setSelectedInstructor={setSelectedInstructor} />
        );
      case "AdminSimulationGroups":
        return <AdminSimulationGroups setSelectedGroup={setSelectedGroup} />;
      case "AdminCreateSimulationGroup":
        return (
          <AdminCreateSimulationGroup
            setSelectedComponent={setSelectedComponent}
          />
        );
      case "AISettings":
        return <AISettings />;
      default:
        return (
          <AdminInstructors setSelectedInstructor={setSelectedInstructor} />
        );
    }
  };

  return (
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh" }}>
      <PageContainer>
        <AppBar
          position="fixed"
          sx={{
            zIndex: (theme) => theme.zIndex.drawer + 1,
            backgroundColor: "white",
            color: "#1f2937",
            boxShadow:
              "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
          }}
          elevation={0}
        >
          <AdminHeader />
        </AppBar>
        <AdminSidebar
          setSelectedComponent={setSelectedComponent}
          setSelectedInstructor={setSelectedInstructor}
          setSelectedGroup={setSelectedGroup}
        />
        {renderComponent()}
      </PageContainer>
    </div>
  );
};

export default AdminHomepage;
