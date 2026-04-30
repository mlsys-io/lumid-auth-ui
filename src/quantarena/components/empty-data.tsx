import React from 'react';
import { Inbox, LucideIcon } from 'lucide-react';
import { Button } from './ui/button';

interface EmptyDataProp {
	title: string;
	description?: string;
	buttonText?: string;
	ButtonIcon?: LucideIcon;
	buttonOnClick?: () => void;
}

const EmptyData = (props: EmptyDataProp) => {
	const { title, description, buttonText, ButtonIcon, buttonOnClick } = props;
	return (
		<div
			className="flex flex-col items-center justify-center py-24 border rounded-lg bg-muted/20"
			style={{ padding: '20px' }}
		>
			<div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
				<Inbox className="w-8 h-8 text-muted-foreground" />
			</div>
			<h3 className="text-lg font-semibold mb-2">{title || 'No Data yet'}</h3>
			{description && <p className="text-sm text-muted-foreground mb-6 max-w-md text-center">{description}</p>}
			{buttonOnClick && (
				<Button onClick={buttonOnClick} className="gap-2 cursor-pointer">
					{ButtonIcon && <ButtonIcon className="h-4 w-4" />}
					{buttonText || 'Create Your First Data'}
				</Button>
			)}
		</div>
	);
};

export default EmptyData;
