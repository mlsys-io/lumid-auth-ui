import React from "react";

// Import all SVG icons
import homeAltIcon from "../../assets/icons/home-alt.svg";
import alignAltIcon from "../../assets/icons/align-alt.svg";
import databaseIcon from "../../assets/icons/database.svg";
import pythonIcon from "../../assets/icons/python.svg";
import cloudDatabaseTreeIcon from "../../assets/icons/cloud-database-tree.svg";
import databaseAltIcon from "../../assets/icons/database-alt.svg";
import cloudDataConnectionIcon from "../../assets/icons/cloud-data-connection.svg";
import fileContractIcon from "../../assets/icons/file-contract.svg";
import fileNetworkIcon from "../../assets/icons/file-network.svg";
import briefcaseIcon from "../../assets/icons/briefcase.svg";
import bellIcon from "../../assets/icons/bell.svg";
import dollarAltIcon from "../../assets/icons/dollar-alt.svg";
import expandAltIcon from "../../assets/icons/expand-alt.svg";
import flaskIcon from "../../assets/icons/flask.svg";
import robotIcon from "../../assets/icons/robot.svg";
import uploadIcon from "../../assets/icons/upload.svg";
import userIcon from "../../assets/icons/user.svg";
import attachIcon from "../../assets/icons/attach.svg";
import copyIcon from "../../assets/icons/copy.svg";
import fileAltIcon from "../../assets/icons/file-alt.svg";
import globalIcon from "../../assets/icons/global.svg";
import lightIcon from "../../assets/icons/light.svg";
import plusIcon from "../../assets/icons/plus.svg";
import voiceWaveIcon from "../../assets/icons/voice-wave.svg";
import fileDownloadAltIcon from "../../assets/icons/file-download-alt.svg";
import trashAltIcon from "../../assets/icons/trash-alt.svg";
import cheveronDownIcon from "../../assets/icons/cheveron-down.svg";
import cheveronRightIcon from "../../assets/icons/cheveron-right.svg";
import searchIcon from "../../assets/icons/search.svg";
import subIcon from "../../assets/icons/sub.svg";
import filterIcon from "../../assets/icons/filter.svg";
import fileSearchAltIcon from "../../assets/icons/file-search-alt.svg";
import sortIcon from "../../assets/icons/sort.svg";
import cpuIcon from "../../assets/icons/cpu.svg";
import shieldcheckIcon from "../../assets/icons/shield-check.svg";
import refreshCwIcon from "../../assets/icons/refresh-cw.svg";
import boxIcon from "../../assets/icons/box.svg";
import gpuIcon from "../../assets/icons/gpu.svg";
import downloadIcon from "../../assets/icons/download.svg";
import cheveronUpIcon from "../../assets/icons/cheveron-up.svg";

// Icon mapping object
const iconMap = {
  "home-alt": homeAltIcon,
  "align-alt": alignAltIcon,
  database: databaseIcon,
  python: pythonIcon,
  "cloud-database-tree": cloudDatabaseTreeIcon,
  "database-alt": databaseAltIcon,
  "cloud-data-connection": cloudDataConnectionIcon,
  "file-contract": fileContractIcon,
  "file-network": fileNetworkIcon,
  briefcase: briefcaseIcon,
  bell: bellIcon,
  "dollar-alt": dollarAltIcon,
  "expand-alt": expandAltIcon,
  flask: flaskIcon,
  robot: robotIcon,
  upload: uploadIcon,
  user: userIcon,
  attach: attachIcon,
  copy: copyIcon,
  "file-alt": fileAltIcon,
  global: globalIcon,
  light: lightIcon,
  plus: plusIcon,
  "voice-wave": voiceWaveIcon,
  "file-download-alt": fileDownloadAltIcon,
  "trash-alt": trashAltIcon,
  "cheveron-down": cheveronDownIcon,
  "cheveron-right": cheveronRightIcon,
  search: searchIcon,
  sub: subIcon,
  filter: filterIcon,
  "file-search-alt": fileSearchAltIcon,
  "sort": sortIcon,
  "cpu": cpuIcon,
  "shield-check": shieldcheckIcon,
  "refresh-cw": refreshCwIcon,
  "box": boxIcon,
  "gpu": gpuIcon,
  "download": downloadIcon,
  "cheveron-up": cheveronUpIcon


} as const;

export type IconName = keyof typeof iconMap;

interface IconProps {
  name: IconName;
  className?: string;
  alt?: string;
  fill?: string;
}

const Icon: React.FC<IconProps> = ({ name, className = "w-4 h-4", alt }) => {
  const iconSrc = iconMap[name];

  if (!iconSrc) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }

  return <img src={iconSrc} alt={alt || name} className={className} />;
};

export default Icon;
