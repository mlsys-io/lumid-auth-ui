import React from "react";

interface CardTemplateProps {
  title: string;
  image: string;
  description: string;
  buttonText: string;
  onButtonClick: () => void;
  className?: string;
}

const CardTemplate: React.FC<CardTemplateProps> = ({
  title,
  image,
  description,
  buttonText,
  onButtonClick,
  className = "",
}) => {
  return (
    <div
      className={`bg-white rounded-xl p-4 hover:shadow-md transition-shadow flex flex-col w-[291px] h-[371px] ${className}`}
    >
      {/* Card Title */}
      <h5 className="text-sm font-medium text-gray-900 mb-3">
        {title}
      </h5>

      {/* Card Image */}
      <div className="h-40 bg-gray-50 rounded-md mb-3 flex items-center justify-center overflow-hidden flex-grow">
        <img
          src={image}
          alt={title}
          className="max-w-full max-h-full object-contain"
        />
      </div>

      {/* Card Description */}
      <p className="text-base text-gray-500 mb-3">
        {description}
      </p>

      {/* Action Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onButtonClick();
        }}
        className="w-full h-[48px] bg-blue text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors mt-auto flex items-center justify-center"
      >
        {buttonText}
      </button>
    </div>
  );
};

export default CardTemplate; 